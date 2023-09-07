/**
 * Aplenture/AppJS
 * https://github.com/Aplenture/AppJS
 * Copyright (c) 2023 Aplenture
 * MIT License https://github.com/Aplenture/AppJS/blob/main/LICENSE
 */

import * as BackendJS from "backendjs";
import * as CoreJS from "corejs";
import * as FS from "fs";
import * as Readline from "readline";
import { App, Server } from "./core";

const PARAMETER_LOGFILE = 'logfile';
const DEFAULT_CONFIG = 'config.json';

const PATH_CONFIGS = 'configs/';
const PATH_SCRIPTS = 'scripts/';

const command = process.argv[2];
const route = process.argv[3] && 0 != process.argv[3].indexOf('-')
    ? process.argv[3]
    : '';

const globalArgs = CoreJS.parseArgsFromString(process.argv.slice(route ? 4 : 3).join(' '));

const config = new CoreJS.Config(...App.Parameters, ...Server.Parameters, ...BackendJS.Module.GlobalParameters);
const infos = BackendJS.loadConfig('package.json');
const commander = new CoreJS.Commander();

let log: BackendJS.Log.Log;
let app: App;
let server: Server;
let scriptSpace = 0;

config.add(new CoreJS.StringParameter(PARAMETER_LOGFILE, 'file path of log file', './app.log'));
config.set(App.PARAMETER_VERSION, infos.version);
config.deserialize(BackendJS.loadConfig(PATH_CONFIGS + DEFAULT_CONFIG));
config.deserialize(globalArgs);

commander.set({
    name: 'start',
    description: "starts the server",
    parameters: new CoreJS.ParameterList(
        new CoreJS.StringParameter('config', 'filepath of additional config', 'server.json'),
        new CoreJS.BoolParameter('server', 'starts also the server', true)
    ),
    execute: async args => {
        if (app)
            return "already running\n";

        const additionalConfigPath: string = args.config;
        const startServer: string = args.server;

        delete args.config;
        delete args.server;

        // deserialize additional config
        if (additionalConfigPath)
            await commander.execute('config.load', { path: additionalConfigPath });

        log = BackendJS.Log.Log.createFileLog(config.get(PARAMETER_LOGFILE));
        log.write(`loaded config '${DEFAULT_CONFIG}'`);
        if (additionalConfigPath) log.write(`loaded config '${additionalConfigPath}'`);

        process.on('exit', code => code && process.stdout.write(`exit with code ${code}\n`));
        process.on('SIGINT', () => commander.execute('stop'));
        process.on('SIGUSR1', () => commander.execute('stop'));
        process.on('SIGUSR2', () => commander.execute('stop'));
        process.on('uncaughtException', error => log.error(error));
        process.on('unhandledRejection', reason => log.error(reason instanceof Error ? reason : reason ? new Error(reason.toString()) : new Error()));

        app = new App(config, args);
        app.onMessage.on((message, sender) => log.write(message, sender.name + ' (App)'));
        app.onError.on((error, sender) => log.error(error, sender.name + ' (App)'));
        await app.init();

        process.title = app.name;

        if (startServer) {
            server = new Server(app, config);
            server.onMessage.on((message, sender) => log.write(message, sender.app.name + ' (Server)'));
            server.onError.on((error, sender) => log.error(error, sender.app.name + ' (Server)'));
            server.start();
        }

        return "started\n";
    }
});

commander.set({
    name: 'stop',
    description: "stops the server",
    execute: async args => {
        if (server)
            await server.stop();

        if (app)
            await app.deinit();

        if (log)
            await log.close();

        return "stopped\n";
    }
});

commander.set({
    name: 'exec',
    description: 'sends request to a server instance',
    parameters: new CoreJS.ParameterList(
        new CoreJS.StringParameter('config', 'filepath of additional config', 'local.json')
    ),
    execute: async args => {
        if (app)
            return await app.execute(route, args)
                .then(result => result.data);

        args.server = false;

        await commander.execute('start', args);

        const result = await app.execute(route, args);

        await commander.execute("stop");

        return result.data;
    }
});

commander.set({
    name: 'script',
    description: 'loads and executes a script file',
    parameters: new CoreJS.ParameterList(
        new CoreJS.StringParameter('path', 'script file path', 'script.txt')
    ),
    execute: async args => {
        const path = `${PATH_SCRIPTS}${args.path}`;

        if (!FS.existsSync(path))
            return `not existing script file at '${path}'\n`;

        const coldStart = !!app;

        if (coldStart)
            await commander.execute("start", { server: false });

        const readline = Readline.createInterface({
            input: FS.createReadStream(path)
        });

        const space = " ".repeat(scriptSpace);

        let result = `executing script ${path}...`;

        scriptSpace = 3;

        for await (const line of readline) {
            result += '\n' + space + '>> ' + line + '\n';
            result += ('<< ' + await commander.executeLine(line)).replace(/^(.)/gm, space + '$1') + '\n';
        }

        if (coldStart)
            await commander.execute("stop");

        return result;
    }
});

commander.set(...config.createCommands());
commander.set({
    name: 'config.load',
    description: "loads an additional config file",
    parameters: new CoreJS.ParameterList(
        new CoreJS.StringParameter('path', 'config file path')
    ),
    execute: async args => {
        const path = `${PATH_CONFIGS}${args.path}`;

        if (!FS.existsSync(path))
            return `not existing config file at '${path}'\n`;

        config.deserialize(BackendJS.loadConfig(path));
        config.deserialize(globalArgs);

        return `additional config loaded from '${path}'\n`;
    }
});

commander.set({
    name: 'config.create',
    description: "writes config to file",
    parameters: new CoreJS.ParameterList(
        new CoreJS.NumberParameter('space', 'serialization option space', 4),
        new CoreJS.ArrayParameter('path', 'config file path', new CoreJS.StringParameter('', ''), ['config.json']),
        new CoreJS.BoolParameter('force', 'overwrites existing config file', false)
    ),
    execute: async args => {
        const result = await Promise.all(args.path.map(async path => {
            path = `${PATH_CONFIGS}${path}`;

            if (FS.existsSync(path) && !args.force)
                return `config file already exist at '${path}'\n`;

            FS.writeFileSync(path, JSON.stringify(config, null, args.space));

            return `config written to file at '${path}'\n`;
        }));

        return result.join('\n') + '\n';
    }
});

commander.set({
    name: 'log.clear',
    description: "clears the log file",
    execute: async args => {
        await BackendJS.Log.Log.clear(config.get(PARAMETER_LOGFILE));

        return `log cleared\n`;
    }
});

commander
    .execute(command, globalArgs)
    .then(result => process.stdout.write(result))
    .catch(error => process.stdout.write(error.stack)); 