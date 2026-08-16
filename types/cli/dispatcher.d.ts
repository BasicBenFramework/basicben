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
    updates: {
        description: string;
        usage: string;
        options: {
            check: string;
            apply: string;
            changelog: string;
            '--json': string;
            '-y, --yes': string;
        };
    };
    plugin: {
        description: string;
        usage: string;
        options: {
            list: string;
            'search <query>': string;
            'install <slug>': string;
            'update <slug>': string;
            'update --all': string;
            'remove <slug>': string;
            'activate <slug>': string;
            'deactivate <slug>': string;
        };
    };
    theme: {
        description: string;
        usage: string;
        options: {
            list: string;
            'search <query>': string;
            'install <slug>': string;
            'update <slug>': string;
            'remove <slug>': string;
            'activate <slug>': string;
        };
    };
    registry: {
        description: string;
        usage: string;
        options: {
            list: string;
            'add <url>': string;
            'remove <url>': string;
            'ping [url]': string;
        };
    };
    license: {
        description: string;
        usage: string;
        options: {
            'set <key>': string;
            status: string;
            remove: string;
        };
    };
    help: {
        description: string;
        usage: string;
    };
};
