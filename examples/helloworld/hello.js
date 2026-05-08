const greet = (name) => `Hello, ${name || 'world'}!`;

module.exports = { greet };

if (require.main === module) {
  console.log(greet());
}
