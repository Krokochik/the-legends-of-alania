export type CommandArgs = Array<string | number>;

export interface Command {
    name: string;
    args: CommandArgs;
}

export function parseCommand(input: string): Command | null {
    input = input?.trim();
    if (!input) return null;

    const regex = /"[^"]*"|'[^']*'|\S+/g;
    const tokens = input.match(regex) || [];

    if (tokens.length === 0) return null;

    const name = tokens[0]!;
    const args: Array<string | number> = [];

    for (let i = 1; i < tokens.length; i++) {
        let token = tokens[i];

        if (
            (token.startsWith('"') && token.endsWith('"')) ||
            (token.startsWith("'") && token.endsWith("'"))
        ) {
            args.push(token.slice(1, -1));
        } else {
            const num = Number(token);
            if (!isNaN(num)) {
                args.push(num);
            } else {
                args.push(token);
            }
        }
    }

    return { name, args };
}
