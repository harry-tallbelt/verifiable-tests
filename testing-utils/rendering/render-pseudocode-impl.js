const { renderPredicate, renderIntegerExpression, renderVariable } =
  require('./render-predicate-impl')

function renderProgram(program, indentStr, lineEnd) {
  return renderStatements(program.statements, 0, indentStr, lineEnd)
}

function renderStatements(statements, nestingLevel, indentStr, lineEnd) {
  return statements
    .map(s => renderStatement(s, nestingLevel, indentStr, lineEnd))
    .join(';' + lineEnd)
}

function renderStatement(statement, nestingLevel, indentStr, lineEnd) {
  const ident = repeatString(indentStr, nestingLevel)
  switch (statement.type) {
    case 'abort':
      return ident + 'abort'
    case 'skip':
      return ident + 'skip'
    case 'assign': {
      const rvalues = []
      const lvalues = []
      for (let i = 0; i < statement.rvalues.length; ++i) {
        if (statement.rvalues[i].type === 'store') {
          let base = statement.rvalues[i].base
          while (base.type === 'store') { base = base.base }
          const lvs = []
          const rvs = []
          for (let st = statement.rvalues[i]; st.type === 'store'; st = st.base) {
            let lv = { type: 'select', base, selector: st.selector }
            let rv = st.value
            while (rv.type === 'store') {
              lv = { type: 'select', base: lv, selector: rv.selector }
              rv = rv.value
            }
            lvs.push(lv)
            rvs.push(rv)
          }
          lvalues.push(... lvs.reverse())
          rvalues.push(... rvs.reverse())
        } else {
          lvalues.push(statement.lvalues[i])
          rvalues.push(statement.rvalues[i])
        }
      }
      const _lvalues = lvalues.map(renderVariable).join(', ')
      const _rvalues = rvalues.map(renderIntegerExpression).join(', ')
      return ident + _lvalues + ' := ' + _rvalues
    }
    case 'if':
    case 'do': {
      const guards = statement.guards.map(renderPredicate)
      const commands = statement.commands.map(s =>
        (s.length === 1 && s[0].type !== 'if' && s[0].type !== 'do')
          ? renderStatement(s[0], 0, '', '')
          : lineEnd + renderStatements(s, nestingLevel + 2, indentStr, lineEnd))
      const guardedCommands = guards.map((guard, i) => {
        const command = commands[i]
        const innerIdent = i === 0
          ? ident + (indentStr === '' ? ' ' : indentStr)
          : ident + '|' + indentStr.slice(1)
        const arrow = command.startsWith(lineEnd) ? '  ->' : '  ->  '
        return innerIdent + guard + arrow + command
      })
      return ident + statement.type + lineEnd
        + guardedCommands.join(lineEnd) + lineEnd
        + ident + (statement.type === 'if' ? 'fi' : 'od')
    }
    default:
      throw new Error(`Unknown type of statement: ${statement.type}.`)
  }
}

function repeatString(str, times) {
  let res = ''
  while (times-- > 0) res += str
  return res
}

module.exports.renderProgram = renderProgram
