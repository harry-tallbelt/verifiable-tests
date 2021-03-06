const assert = require('assert')
const { flatten } = require('./utils')
const { substitutePredicate } = require('./substitution')

/* Processes program and specification to get
 * the list of predicates, prooving which will
 * mean the program's validity.
 * Here `program` is an object tree representation of
 * the program being proven or a list of statements,
 * `spec` is an object, that contains fields
 *  - `precondition` with precondition predicate,
 *  - `postcondition` with postcondition predicate,
 *  - `loops` with list of { invariant, variant } objects (may be omitted),
 * `context` field is used by WP to propagate context through recursive calls.
 * You don't need to specify it.
 * WP returns an object of two fields:
 *  - `predicates`, the list of predicates to proove,
 *  - `context`, the that for each predicate of `predicates` provides
 *    a list of context objects, collected while aquiring the predicate.
*/
function wp(spec, program, context) {
  const Q = spec.precondition
  const R = spec.postcondition
  const S = Array.isArray(program) ? program : program.statements
  context = context || []

  if (S.length === 0) {     // an empty program acts
    const implication = {   // like a skip statement
      type: 'implies',
      left: Q,
      right: R
    }

    if (context.length === 0) {
      context.push({                // Empty program might contain
        start: { row: 0, col: 0 },  // whitespaces, so it won't
        end: { row: 0, col: 0 },    // end at 0:0, but we cannot
        type: 'seq'                 // access the real coordinates.
      })
    }

    return {
      predicates: [implication],
      context: [context]
    }
  }

  const firstLoopIndex = S.findIndex(st => st.type === 'do')
  if (firstLoopIndex >= 0) {
    const DO = S[firstLoopIndex]
    const loop = spec.loops.shift()
    const P = loop.invariant
    const t = loop.variant
    const I = S.slice(0, firstLoopIndex)   // commands before the loop
    const J = S.slice(firstLoopIndex + 1)  // commands after the loop

    return doTheorem(Q, R, P, t, I, DO, J, spec, context)
  }

  const firstIfIndex = S.findIndex(st => st.type === 'if')
  if (firstIfIndex >= 0) {
    const IF = S[firstIfIndex]
    const I = S.slice(0, firstIfIndex)    // commands before if
    const J = S.slice(firstIfIndex + 1)   // commands after if

    return ifTheorem(Q, R, I, IF, J, spec, context)
  }

  return elementarySequenceWp(Q, S, R, context)
}



/* Uses DO theorem to generate proof for {Q} I; DO; J {R}
 * with invariant P and boundary function t.
 * specBase is used to keep track of context,
 * invariants and boundary functions.
*/
function doTheorem(Q, R, P, t, I, DO, J, innerSpec, context) {
  const BB = disjunction(DO.guards)
  
  if (I.length === 0) {
    I.push({
      type: 'skip',
      textRange: DO.textRange
    })
  }

  if (J.length === 0) {
    J.push({
      type: 'skip',
      textRange: DO.textRange
    })
  }
  
  const results = flatten([
    doTheoremPt1(Q, I, P, innerSpec, context),
    doTheoremPt2(P, DO, innerSpec, context),
    doTheoremPt3(P, R, BB, J, innerSpec, context),
    doTheoremPt5(P, t, DO, innerSpec, context),
    doTheoremPt6(t, DO, context)
  ]).map(args => wp(args.spec, args.prog, args.ctx))

  // pt. 4 returns a predicate, so no wp call needed
  results.push(doTheoremPt4(P, t, BB, DO, innerSpec, context))

  return combineResults(results)
}

// {Q} I {P}
function doTheoremPt1(Q, I, P, innerSpec, context) {
  const contextObject = createContext({ command: I, type: 'do', step: 1 })
  return wrapWpArguments(Q, I, P, innerSpec, [contextObject, ... context])
}

// {P ^ Bi} Ci {P} for i = 1..n
function doTheoremPt2(P, DO, innerSpec, context) {
  const wrappedWpArgs = DO.guards.map((guard, i) => {
    const command = DO.commands[i]
    const precondition = { type: 'and', left: P, right: guard }
    const contextObject =
      createContext({ command: command, type: 'do', step: 2, branch: i + 1})
    const newContext = [contextObject, ... context]
    return wrapWpArguments(precondition, command, P, innerSpec, newContext)
  })

  return wrappedWpArgs
}

// {P ^ ~BB} J {R}
function doTheoremPt3(P, R, BB, J, innerSpec, context) {
  const contextObject = createContext({ command: J, type: 'do', step: 3})
  const newContext = [contextObject, ... context]
  const precondition = {
    type: 'and',
    left: P,
    right: { type: 'not', inner: BB }
  }

  return wrapWpArguments(precondition, J, R, innerSpec, newContext)
}

// P ^ BB => t > 0
function doTheoremPt4(P, t, BB, DO, innerSpec, context) {
  const contextObject = createContext({ command: DO, type: 'do', step: 4 })
  const newContext = [contextObject, ... context]
  const implication = {
    type: 'implies',
    left: { type: 'and', left: P, right: BB },
    right: {
      type: 'comp',
      op: '>',
      left: t,
      right: { type: 'const', const: 0 }
    }
  }
  return {
    predicates: [implication],
    context: [newContext]
  }
}

// {P ^ Bi} @t := t; Ci' {t < @t} for i = i..n,
// where Ci' is Ci without loops.
function doTheoremPt5(P, t, DO, innerSpec, context) {
  const wrappedWpArgs = DO.guards.map((guard, i) => {
    const command = withoutLoops(DO.commands[i])
    const tInit = {
      type: 'name',       // This '@' symbol does not make it
      name: '@t_init'     // to simplify. It is only used in wp.
    }
    const fakeAssignment = {            // We reuse first command's text range
      textRange: command[0].textRange,  // so it would seem like our command
      type: 'assign',                   // takes no space in source code.
      lvalues: [tInit],
      rvalues: [t]
    }
    command.unshift(fakeAssignment)
    const precondition = {
      type: 'and',
      left: P,
      right: guard
    }
    const postcondition = {
      type: 'comp',
      op: '<',
      left: t,
      right: { type: 'var', var: tInit }
    }
    const contextObject = createContext({
      command: DO.commands[i],
      type: 'do',
      step: 5,
      branch: i + 1
    })
    const newContext = [contextObject, ... context]
    return wrapWpArguments(precondition, command, postcondition, innerSpec, newContext)
  })

  return wrappedWpArgs
}

// {T = t} Xi {T = t},
// where Xi are the branches of all the nested loops
// with their loops cut out.
function doTheoremPt6(t, DO, context) {
  const QR = {
    type: 'comp',
    op: '=',
    left: {                            // Usage of var name T is safe,
      type: 'var',                     // as the proof does not use 
      var: { type: 'name', name: 'T' } // any of spec predicates
    },                                 // that might contain T.
    right: t
  }
  const contextFor = S =>
    [createContext({ command: S, type: 'do', step: 6, loop: DO }), ... context]
  const wpArgumentsFor = S => wrapWpArguments(QR, S, QR, null, contextFor(S))
  return subloopsBranches(DO).map(wpArgumentsFor)
}

function loops(S) {
  const plainLoops = S.filter(s => s.type === 'do')
  const loopsInIfs = flatten(S.filter(s => s.type === 'if').map(ifLoops))
  return plainLoops.concat(loopsInIfs)
}

const ifLoops = IF => flatten(IF.commands.map(loops))
const withoutLoops = S => S.filter(s => s.type !== 'do')
  .map(s => s.type === 'if' ? ifWithoutLoops(s) : s)

function ifWithoutLoops(IF) {
  const ifCopy = Object.assign({}, IF)
  ifCopy.commands = IF.commands.map(withoutLoops)
  return ifCopy
}

const loopSubloops = DO => flatten(DO.commands.map(loops))
const loopOwnBranches = DO => DO.commands.map(withoutLoops)
const subloopsBranches = DO => flatten(loopSubloops(DO).map(allLoopBranches))
const allLoopBranches = DO => loopOwnBranches(DO).concat(subloopsBranches(DO))



/* Uses IF theorem to generate proof for {Q} I; IF; J {R}
 * with invariant P and boundary function t.
 * specBase is used to keep track of context,
 * invariants and boundary functions.
*/
function ifTheorem(Q, R, I, IF, J, innerSpec, context) {
  const BB = disjunction(IF.guards)
  
  if (I.length === 0) {
    I.push({
      type: 'skip',
      textRange: IF.textRange
    })
  }

  if (J.length === 0) {
    J.push({
      type: 'skip',
      textRange: IF.textRange
    })
  }

  const results = flatten([
    ifTheoremPt1(Q, BB, I, innerSpec, context),
    ifTheoremPt2(Q, R, BB, I, IF, J, innerSpec, context)
  ]).map(args => wp(args.spec, args.prog, args.ctx))

  return combineResults(results)
}


function ifTheoremPt1(Q, BB, I, innerSpec, context) {
  const contextObject = createContext({ command: I, type: 'if', step: 1 })
  return wrapWpArguments(Q, I, BB, innerSpec, [contextObject, ... context])
}


function ifTheoremPt2(Q, R, BB, I, IF, J, innerSpec, context) {
  const wrappedWpArgs = IF.guards.map((guard, i) => {
    const commands = I.concat(IF.commands[i]).concat(J)
    const precondition = {
      type: 'and',
      left: Q,
      // we get Q => WP(I, B_i) and take the right part
      right: elementarySequenceWp(Q, I, guard, []).predicates[0].right
    }
    const contextObject = createContext({
      command: commands,
      type: 'if',
      step: 2,
      branch: i + 1
    })
    const newContext = [contextObject, ... context]
    return wrapWpArguments(precondition, commands, R, innerSpec, newContext)
  })
  return wrappedWpArgs
}



/* Generates a proof of elementary command sequence.
*/
function elementarySequenceWp(Q, S, R, context) {
  let seqWp = S.reduceRight((predicate, command) => {
    switch (command.type) {
      case 'abort':
        return { type: 'const', const: false }
      case 'skip':
        return predicate
      case 'assign':
       return substitutePredicate(predicate, command.lvalues, command.rvalues)
    }
  }, R)

  if (seqWp === R) {               // copy R in case there
    seqWp = Object.assign({}, R)   // was nothing but skip's
  }

  const implication = { type: 'implies', left: Q, right: seqWp }
  const contextObject = createContext({ command: S, type: 'seq' })
  const newContext = [contextObject, ... context]

  return {
    predicates: [implication],
    context: [newContext]
  }
}


function combineResults(results) {
  return results.reduce((acc, res) => ({
    predicates: acc.predicates.concat(res.predicates),
    context: acc.context.concat(res.context)
  }))
}

function disjunction(predicates) {
  return predicates.reduce((conj, pred) => ({
    type: 'or',
    left: conj,
    right: pred
  }))
}

// You can omit step and branch
function createContext({ command, type, step, branch, loop }) {
  let context = { type, step, branch }

  if (Array.isArray(command)) {
    // We make sure the array is not empty in calling methods
    assert(command.length > 0)
    context.start = command[0].textRange.start
    context.end = command[command.length - 1].textRange.end
  } else {
    context.start = command.textRange.start
    context.end = command.textRange.end
  }

  if (loop) {
    context.loop = {
      start: loop.textRange.start,
      end: loop.textRange.end
    }
  }

  return context
}

// Wraps three WP arguments in one object
function wrapWpArguments(Q, S, R, innerSpec, context) {
  const spec = Object.assign({}, innerSpec, {
    precondition: Q,
    postcondition: R
  })

  return {
    spec: spec,
    prog: S,
    ctx: context
  }
}

module.exports = wp
