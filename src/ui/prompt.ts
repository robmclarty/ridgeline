export const askBuildName = async (): Promise<string> => {
  const readline = require("node:readline")
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const name = await new Promise<string>((resolve) => {
    rl.question("Build name: ", (answer: string) => {
      rl.close()
      resolve(answer.trim())
    })
  })
  return name
}
