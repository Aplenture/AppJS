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
const PATH_CONFIG = 'configs/';
const DEFAULT_CONFIG = 'config.json';

const command = process.argv[2];
const route = process.argv[3] && 0 != process.argv[3].indexOf('-')
    ? process.argv[3]
    : '';

const globalArgs = CoreJS.parseArgsFromString(process.argv.slice(route ? 4 : 3).join(' '));

const commander = new CoreJS.Commander();
const config = new CoreJS.Config(...App.Parameters, ...Server.Parameters, ...BackendJS.Module.GlobalParameters);
const infos = BackendJS.loadConfig('package.json');

let server: Server;

config.add(new CoreJS.StringParameter(PARAMETER_LOGFILE, 'file path of log file', './app.log'));
config.set(App.PARAMETER_VERSION, infos.version);
config.deserialize(BackendJS.loadConfig(PATH_CONFIG + DEFAULT_CONFIG));
config.deserialize(globalArgs);

commander.set({
    name: 'start',
    description: "starts the server",
    parameters: new CoreJS.ParameterList(
        new CoreJS.StringParameter('config', 'filepath of additional config', 'server.json')
    ),
    execute: async args => {
        if (server)
            return "server is already running\n";

        const additionalConfigPath: string = args.config;

        delete args.config;

        // deserialize additional config
        if (additionalConfigPath)
            await commander.execute('config.load', { path: additionalConfigPath });

        const log = BackendJS.Log.Log.createFileLog(config.get(PARAMETER_LOGFILE));

        log.write(`loaded config '${DEFAULT_CONFIG}'`);
        if (additionalConfigPath) log.write(`loaded config '${additionalConfigPath}'`);

        process.on('exit', code => process.stdout.write(`server stopped${code ? ` with exit code ${code}` : ''}\n`));
        process.on('SIGINT', () => commander.execute('stop'));
        process.on('SIGUSR1', () => commander.execute('stop'));
        process.on('SIGUSR2', () => commander.execute('stop'));
        process.on('uncaughtException', error => log.error(error));
        process.on('unhandledRejection', reason => log.error(reason instanceof Error ? reason : reason ? new Error(reason.toString()) : new Error()));

        const app = new App(config, args);
        app.onMessage.on((message, sender) => log.write(message, sender.name + ' (App)'));
        app.onError.on((error, sender) => log.error(error, sender.name + ' (App)'));
        await app.init();

        process.title = app.name;

        server = new Server(app, config);
        server.onMessage.on((message, sender) => log.write(message, sender.app.name + ' (Server)'));
        server.onError.on((error, sender) => log.error(error, sender.app.name + ' (Server)'));
        server
            .start()
            .then(() => app.deinit())
            .then(() => log.close());

        return "server started\n";
    }
});

commander.set({
    name: 'stop',
    description: "stops the server",
    execute: async args => {
        if (!server)
            return "server is not running\n";

        server.stop();

        return "server stopped\n";
    }
});

commander.set({
    name: 'exec',
    description: 'sends request to a server instance',
    parameters: new CoreJS.ParameterList(
        new CoreJS.StringParameter('config', 'filepath of additional config', 'local.json'),
        new CoreJS.BoolParameter('start', 'starts server if it is not running already', true),
    ),
    execute: async args => {
        const additionalConfigPath: string = args.config;
        const start: boolean = args.start;

        delete args.config;
        delete args.start;

        // deserialize additional config
        if (additionalConfigPath)
            await commander.execute('config.load', { path: additionalConfigPath });

        return await new Promise<string>((resolve, reject) => {
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

            request.on('error', (error: any) => {
                switch (error.errno) {
                    // server is not running
                    case -111: //ECONNREFUSED
                        if (!start)
                            return resolve('server is not running\n');

                        // start the server
                        // and retry exec
                        return commander
                            .execute('start', { config: additionalConfigPath })
                            .then(() => commander.execute('exec', Object.assign({}, args, {
                                config: '',
                                start: false
                            })))
                            .then(resolve)
                            .catch(reject)
                            .then(() => commander.execute('stop'));

                    default:
                        return reject(error);
                }
            });

            request.end();
        });
    }
});

commander.set({
    name: 'config.get',
    description: "returns the config",
    parameters: new CoreJS.ParameterList(
        new CoreJS.NumberParameter('space', 'serialization option space', 4)
    ),
    execute: async args => JSON.stringify(config, null, args.space)
});

commander.set({
    name: 'config.load',
    description: "loads an additional config file",
    parameters: new CoreJS.ParameterList(
        new CoreJS.StringParameter('path', 'config file path')
    ),
    execute: async args => {
        const path = `${PATH_CONFIG}${args.path}`;

        if (!FS.existsSync(path))
            return `not existing config file at '${path}'`;

        config.deserialize(BackendJS.loadConfig(path));
        config.deserialize(globalArgs);

        return `additional config loaded from '${path}'`;
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
            path = `${PATH_CONFIG}${path}`;

            if (FS.existsSync(path) && !args.force)
                return `config file already exist at '${path}'`;

            FS.writeFileSync(path, JSON.stringify(config, null, args.space));

            return `config written to file at '${path}'`;
        }));

        return result.join('\n') + '\n';
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
    .execute(command, globalArgs)
    .then(result => process.stdout.write(result))
    .catch(error => process.stdout.write(error.stack)); 