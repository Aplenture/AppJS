/**
 * Aplenture/AppJS
 * https://github.com/Aplenture/AppJS
 * Copyright (c) 2023 Aplenture
 * MIT License https://github.com/Aplenture/AppJS/blob/main/LICENSE
 */

import * as BackendJS from "backendjs";
import * as CoreJS from "corejs";
import * as FS from "fs";
import * as HTTP from "http";
import { App, Server } from "./core";

const PARAMETER_LOGFILE = 'logfile';

const command = process.argv[2];
const route = process.argv[3] && 0 != process.argv[3].indexOf('-')
    ? process.argv[3]
    : '';

const args = CoreJS.parseArgsFromString(process.argv.slice(route ? 4 : 3).join(' '));

const commander = new CoreJS.Commander();
const commandLine = process.argv.slice(2).join(' ');
const config = new CoreJS.Config(...App.Parameters, ...Server.Parameters, ...BackendJS.Module.GlobalParameters);
const infos = BackendJS.loadConfig('package.json');

config.add(new CoreJS.StringParameter(PARAMETER_LOGFILE, 'file path of log file', './log.log'));
config.set(App.PARAMETER_VERSION, infos.version);
config.deserialize(BackendJS.loadConfig('configs/config.json'));
config.deserialize(args);

const log = BackendJS.Log.Log.createFileLog(config.get(PARAMETER_LOGFILE));

process.on('exit', code => code && log.write("exit with code " + code));
process.on('SIGINT', () => log.close().then(() => process.exit()));
process.on('SIGUSR1', () => log.close().then(() => process.exit()));
process.on('SIGUSR2', () => log.close().then(() => process.exit()));
process.on('uncaughtException', error => log.error(error));
process.on('unhandledRejection', reason => log.error(reason instanceof Error ? reason : reason ? new Error(reason.toString()) : new Error()));

// commander.set({
//     name: 'help',
//     description: 'lists all commands or returns details of specific <command>',
//     parameters: new CoreJS.ParameterList(
//         new CoreJS.StringParameter('command', 'Lists all commands with this prefix or returns details of specific command.', '')
//     ),
//     execute: async args => {
//         const app = new App(config, args);

//         app.onError.on(error => process.stdout.write(error.stack));
//         app.onError.on((error: any) => process.exit(error.code));

//         await app.init();
//         await app.load(...config.get<any[]>(PARAMETER_PUBLIC_ROUTES));

//         return app.description;
//     }
// });

commander.set({
    name: 'start',
    description: "starts the server",
    parameters: new CoreJS.ParameterList(
        new CoreJS.StringParameter('config', 'filepath of additional config', 'server'),
    ),
    execute: async args => {
        // deserialize additional config
        if (args.config) {
            process.stdout.write(`load additional config '${args.config}'\n`);
            await commander.execute('config.get', { path: args.config });

            delete args.config;
        }

        const app = new App(config, args);
        const server = new Server(app, config);

        process.title = app.name;

        app.onMessage.on(message => log.write(message));
        app.onError.on(error => log.error(error));

        server.onMessage.on(message => log.write(message));
        server.onError.on(error => log.error(error));

        process.stdout.write('init app\n');
        await app.init();

        process.stdout.write('start server\n');
        await server.start();

        return "server stopped\n";
    }
});

commander.set({
    name: 'exec',
    description: 'executes public and private commands',
    parameters: new CoreJS.ParameterList(
        new CoreJS.StringParameter('config', 'filepath of additional config', 'cli'),
    ),
    execute: async args => {
        // deserialize additional config
        await commander.execute('config.get', { path: args.config });

        delete args.config;

        const app = new App(config, args);

        process.title = `${app.name} ${commandLine}`;

        app.onError.on(error => process.stdout.write(error.stack + '\n'));

        await app.init();

        const response = await app.execute(route, args);

        return response.data;
    }
});

commander.set({
    name: 'request',
    description: 'sends request to the server',
    execute: async args => new Promise<string>((resolve, reject) => {
        const params = CoreJS.URLArgsToString(args);
        const path = params
            ? `/${route}?${params}`
            : `/${route}`;

        const request = HTTP.request({
            host: config.get(Server.PARAMETER_HOST),
            port: config.get(Server.PARAMETER_PORT),
            path,
            method: 'GET'
        }, response => {
            let data = '';

            response.on('error', reject);
            response.on('data', chunk => data += chunk);
            response.on('close', () => {
                switch (response.statusCode) {
                    case CoreJS.ResponseCode.OK:
                        resolve(data.toString());
                        break;

                    default:
                        resolve(`Error ${response.statusCode}: ${data.toString()}`);
                        break;
                }
            });
        });

        request.on('error', reject);
        request.end();
    })
});

commander.set({
    name: 'config.get',
    description: "returns the config",
    parameters: new CoreJS.ParameterList(
        new CoreJS.StringParameter('type', 'serialization type', CoreJS.SerializationType.JSON),
        new CoreJS.NumberParameter('space', 'serialization option space', 4),
        new CoreJS.StringParameter('path', 'config file path', 'config')
    ),
    execute: async args => {
        const path = `configs/${args.path}.json`;

        if (FS.existsSync(path))
            config.deserialize(BackendJS.loadConfig(path));
        else
            FS.writeFileSync(path, config.serialize(args));

        return config.serialize(args);
    }
});

commander.set({
    name: 'config.create',
    description: "writes config to file",
    parameters: new CoreJS.ParameterList(
        new CoreJS.StringParameter('type', 'serialization type', CoreJS.SerializationType.JSON),
        new CoreJS.NumberParameter('space', 'serialization option space', 4),
        new CoreJS.StringParameter('path', 'config file path', 'config'),
        new CoreJS.BoolParameter('force', 'overwrites existing config file', false)
    ),
    execute: async args => {
        const path = `configs/${args.path}.json`;

        if (FS.existsSync(path) && !args.force)
            return `config file already exist at '${path}'\n`;

        FS.writeFileSync(path, config.serialize(args));

        return `config written to file at '${path}'\n`;
    }
});

commander.set({
    name: 'config.clear',
    description: "clears the config file",
    execute: async args => {
        await BackendJS.Log.Log.clear(config.get(PARAMETER_LOGFILE));

        return `config cleared\n`;
    }
});

commander
    .execute(command, args)
    .then(result => process.stdout.write(result))
    .catch(error => process.stdout.write(error.stack))
    .then(() => log.close())
    .then(() => process.exit()); 