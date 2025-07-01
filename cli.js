import { Command as Commander } from "commander";
import * as fs from "node:fs";
import RequireCommand from "./src/Command/RequireCommand.js";
import InitCommand from "./src/Command/InitCommand.js";
import RemoveCommand from "./src/Command/RemoveCommand.js";
import BuildCommand from "./src/Command/BuildCommand.js";
import Project from "./src/Project.js";

let project = new Project();
let packageJson = JSON.parse(await fs.promises.readFile(new URL("./package.json", import.meta.url), "utf-8"));

let program = new Commander()
    .name("bedrock-addon-helper")
    .description("A cli tool for managing Bedrock Addon projects")
    .version(packageJson.version)

/**
 * @type {Command[]}
 */
const commands = [
    new RequireCommand(project),
    new InitCommand(project),
    new RemoveCommand(project),
    new BuildCommand(project)
];

for (let command of commands) {
    let cmd = program
        .command(command.getName())
        .action(async (...args) => {
            args.pop();
            let options = args.pop();
            let exitCode = await command.run(args, options);
            if (exitCode !== undefined) {
                process.exit(exitCode);
            }
        });

    await command.configure(cmd);
}

program.parse();

