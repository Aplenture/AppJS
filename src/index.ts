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
import * as HTTP from "http";
import { App, AppParameter, RouteData, Server, ServerParameter } from "./core";

enum Paramter {
    Logfile = 'logfile'
}

enum Path {
    Configs = 'configs/',
    Scripts = 'scripts/',
    Logs = 'logs/'
}

const PREFIX_APP_ROUTE = 'app.';

const config = new CoreJS.Config();

let log: BackendJS.Log.Log;

// listen to log file config changes
config.onChange.on((key, config) => {
    const filepath = Path.Logs + config.get<string>(key);

    if (log)
        log.write(`switch to log file '${filepath}'`)

    log = BackendJS.Log.Log.createFileLog(filepath);
}, { args: Paramter.Logfile });

// add log file paramter to config
config.add(new CoreJS.StringParameter(Paramter.Logfile, 'file path of log file', 'app.log'));

process.on('exit', code => code && process.stdout.write(`exit with code ${code}\n`));
process.on('uncaughtException', error => log.error(error));
process.on('unhandledRejection', reason => log.error(reason instanceof Error ? reason : reason ? new Error(reason.toString()) : new Error()));

// listen to config changes before adding app and server parameters
config.onChange.on(key => log.write(`debug mode changed to '${config.get(key)}'`), { args: BackendJS.Module.GlobalParamterName.Debug });
config.onChange.on(() => {
    const routes: NodeJS.ReadOnlyDict<RouteData> = config.get(AppParameter.Routes) || {};
    const oldAppCommands = Object.keys(commander.commands)
        .filter(command => 0 == command.indexOf(PREFIX_APP_ROUTE));

    commander.remove(...oldAppCommands);

    // create commands by routes
    // execute command by server
    // if server is not execute start and retry to execute the command
    commander.set(...Object.keys(routes).map(route => ({
        name: PREFIX_APP_ROUTE + route,
        description: routes[route].description,
        execute: args => new Promise<string>((resolve, reject) => {
            const params = CoreJS.URLArgsToString(args);
            const path = params
                ? `/${route}?${params}`
                : `/${route}`;

            const request = HTTP.request({
                host: config.get(ServerParameter.Host),
                port: config.get(ServerParameter.Port),
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

                        case CoreJS.ResponseCode.NoContent:
                            resolve('done\n');
                            break;

                        default:
                            resolve(`Error ${response.statusCode}: ${data.toString()}\n`);
                            break;
                    }
                });
            });

            request.on('error', (error: any) => {
                switch (error.errno) {
                    // server is not running
                    case -111: //ECONNREFUSED
                        commander.execute('start')
                            .then(() => commander.execute(PREFIX_APP_ROUTE + route, args))
                            .then(resolve)
                            .catch(reject)
                            .then(() => commander.execute('stop'));
                        break;

                    default:
                        reject(error);
                        break;
                }
            });

            request.end();
        })
    })));
}, { args: null });

const app = new App(config);
const server = new Server(app, config);

app.onMessage.on(message => log.write(message, 'App'));
app.onError.on(error => log.error(error, 'App'));

server.onMessage.on(message => log.write(message, 'Server'));
server.onError.on(error => log.error(error, 'Server'));

// listen to config changes after adding app and server parameters
config.onChange.on(() => process.title = app.name, { args: AppParameter.Name });

const infos = BackendJS.loadConfig('package.json');

config.set(AppParameter.Version, infos.version);

const commander = new CoreJS.Commander();

CoreJS.GlobalEventManager .onMessage.on(message => log.write(message, 'Commander'));

process.on('SIGINT', () => commander.execute('stop'));
process.on('SIGUSR1', () => commander.execute('stop'));
process.on('SIGUSR2', () => commander.execute('stop'));

commander.set({
    name: 'start',
    description: "starts the server",
    execute: async args => {
        // load args to config
        config.deserialize(args);

        // remove all previous app routes from commander
        commander.remove(...Object.keys(app.routes).map(route => PREFIX_APP_ROUTE + route));

        await app.deinit();
        await app.init();

        // add app routes as commands to commander
        commander.set(...Object.keys(app.routes).map(route => {
            const data = app.routes[route];

            return {
                name: PREFIX_APP_ROUTE + route,
                description: data.description,
                parameters: data.parameters,
                execute: async args => app.execute(route, args).then(result => {
                    switch (result.code) {
                        case CoreJS.ResponseCode.OK:
                            return result.data;

                        case CoreJS.ResponseCode.NoContent:
                            return 'done\n';

                        default:
                            return `Error ${result.code}: ${result.data.toString()}`;
                    }
                })
            }
        }));

        server.start();

        return server && server.isRunning
            ? `started to listen on ${server.endpoint}\n`
            : `started\n`;
    }
});

commander.set({
    name: 'stop',
    description: "stops the server",
    execute: async args => {
        await server.stop();
        await app.deinit();
        await log.close();

        return "stopped\n";
    }
});

let scriptSpace = 0;

commander.set({
    name: 'script',
    description: 'executes a script file',
    parameters: new CoreJS.ParameterList(
        new CoreJS.StringParameter('path', 'script file path')
    ),
    execute: async args => {
        const path = `${Path.Scripts}${args.path}`;

        if (!FS.existsSync(path))
            return `not existing script file at '${path}'\n`;

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
        const path = `${Path.Configs}${args.path}`;

        if (!FS.existsSync(path))
            return `not existing config file at '${path}'\n`;

        log.write(`load config file '${path}'`);
        config.deserialize(BackendJS.loadConfig(path));

        return `loaded config file '${path}'\n`;
    }
});

commander.set({
    name: 'config.create',
    description: "writes config to file",
    parameters: new CoreJS.ParameterList(
        new CoreJS.NumberParameter('space', 'serialization option space', 4),
        new CoreJS.ArrayParameter('path', 'config file path', new CoreJS.StringParameter('', '')),
        new CoreJS.BoolParameter('force', 'overwrites existing config file', false)
    ),
    execute: async args => {
        const result = await Promise.all(args.path.map(async path => {
            path = `${Path.Configs}${path}`;

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
    description: "clears a log file",
    parameters: new CoreJS.ParameterList(
        new CoreJS.StringParameter('path', 'log file path', '')
    ),
    execute: async args => {
        const path = Path.Logs + (args.path || config.get(Paramter.Logfile));

        if (!FS.existsSync(path))
            return `not existing log file at '${path}'`;

        await BackendJS.Log.Log.clear(path);

        return `cleared file '${path}'\n`;
    }
});

commander
    .executeLine('config.load --path config.json')
    .then(() => commander.executeLine(process.argv.slice(2).join(' ')))
    .then(result => process.stdout.write(result))
    .catch(error => process.stdout.write(error.stack)); 