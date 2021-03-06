const antlr4 = require('antlr4')
const PseudocodeLexer = require('./PseudocodeLexer')
const PseudocodeParser = require('./PseudocodeParser')
const ProgramRepresenatationBuilder = require('./ProgramRepresenatationBuilder')
const ErrorListListener = require('./ErrorListListener')

/* Parses given source code and returns object
 * with two fields:
 * - `errors`, the list of the errors
 *   of format `{ row, col, message }`,
 *   collected during source code parsing.
 * - `program`, the program representation;
 *   it will be `null` if `errors` is not empty.
*/
function parsePseudocode(sourceCode) {
  const errorKeeper = new ErrorListListener()

  const chars = new antlr4.InputStream(sourceCode)
  const lexer = new PseudocodeLexer.PseudocodeLexer(chars)
  lexer.removeErrorListeners()
  lexer.addErrorListener(errorKeeper)

  const tokens = new antlr4.CommonTokenStream(lexer)
  const parser = new PseudocodeParser.PseudocodeParser(tokens)
  parser.removeErrorListeners()
  parser.addErrorListener(errorKeeper)

  const tree = parser.program()

  if (errorKeeper.errors.length !== 0) {
    return { errors: errorKeeper.errors, program: null }
  }

  const builder = new ProgramRepresenatationBuilder()
  const program = builder.visit(tree)

  return { errors: [], program }
}

module.exports = parsePseudocode
