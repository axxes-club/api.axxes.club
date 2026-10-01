const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/lib/prisma.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
for (const environment of ['production', 'development']) {
  test(`repeated module evaluations share one Prisma client in ${environment}`, () => {
    const sharedGlobal = {};
    let constructed = 0;
    class FakePrismaClient { constructor() { constructed++; } }
    function evaluate() {
      const context = vm.createContext({ exports: {}, globalThis: sharedGlobal, process: { env: { NODE_ENV: environment } }, require: () => ({ PrismaClient: FakePrismaClient }) });
      vm.runInContext(compiled, context);
      return context.exports.prisma;
    }
    const first = evaluate();
    const second = evaluate();
    assert.equal(first, second);
    assert.equal(constructed, 1);
  });
}
