export interface LoadModuleConfig {
    readonly class: string;
    readonly path: string;
}

export function loadModule<T>(config: LoadModuleConfig, ...args: any[]): T {
    const path = `${process.env.PWD}/${config.path}.js`;

    let constructor: new (...args: any[]) => T;

    try {
        constructor = require(path)[config.class];
    } catch (error) {
        throw new Error(`module '${config.class}' not found at '${path}'`);
    }

    return new constructor(...args);
}