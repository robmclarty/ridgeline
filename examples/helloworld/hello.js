'use strict';

const DEFAULT_NAME = 'world';

function greet(name) {
  name = name || DEFAULT_NAME;
  return `Hello, ${name}!`;
}

module.exports = { greet };

if (require.main === module) {
  console.log(greet());
}
