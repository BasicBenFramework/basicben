export function dispatch(command: any, args: any, flags: any): Promise<void>;
export const commandMeta: {
    dev: {
        description: string;
        usage: string;
        options: {
            '--port <port>': string;
        };
    };
    build: {
        description: string;
        usage: string;
        options: {
            '--static': string;
        };
    };
    start: {
        description: string;
        usage: string;
        options: {
            '--port <port>': string;
        };
    };
    test: {
        description: string;
        usage: string;
        options: {
            '--watch, -w': string;
            '--coverage': string;
            '--ui': string;
        };
    };
    'make:controller': {
        description: string;
        usage: string;
        example: string;
    };
    'make:model': {
        description: string;
        usage: string;
        example: string;
    };
    'make:route': {
        description: string;
        usage: string;
        example: string;
    };
    'make:migration': {
        description: string;
        usage: string;
        example: string;
    };
    'make:middleware': {
        description: string;
        usage: string;
        example: string;
    };
    migrate: {
        description: string;
        usage: string;
    };
    'migrate:rollback': {
        description: string;
        usage: string;
    };
    'migrate:fresh': {
        description: string;
        usage: string;
    };
    'migrate:status': {
        description: string;
        usage: string;
    };
    'content:rerender': {
        description: string;
        usage: string;
        options: {
            '--dry-run': string;
        };
        example: string;
    };
    seed: {
        description: string;
        usage: string;
        example: string;
    };
    'make:seed': {
        description: string;
        usage: string;
        example: string;
    };
    help: {
        description: string;
        usage: string;
    };
};
