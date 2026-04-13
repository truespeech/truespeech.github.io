const VALID_GRAINS = new Set(["day", "week", "month", "quarter", "year"]);
const VALID_OPERATORS = new Set(["=", "!=", ">", "<", ">=", "<="]);
/**
 * Parse a CLI command string into a structured command object.
 */
export function parseCommand(input) {
    const trimmed = input.trim();
    if (!trimmed) {
        return { type: "error", message: 'No command entered. Type "help" for available commands.' };
    }
    const parts = trimmed.split(/\s+/);
    const command = parts[0].toLowerCase();
    switch (command) {
        case "help":
            return { type: "help" };
        case "metrics":
            return { type: "metrics" };
        case "dimensions": {
            const metric = parts[1];
            if (!metric) {
                return {
                    type: "error",
                    message: 'Usage: dimensions <metric>\nExample: dimensions total_sales',
                };
            }
            return { type: "dimensions", metric };
        }
        case "query":
            return parseQueryCommand(trimmed);
        default:
            return {
                type: "error",
                message: `Unknown command "${command}". Type "help" for available commands.`,
            };
    }
}
function parseQueryCommand(input) {
    // Remove the "query" prefix
    const rest = input.slice(5).trim();
    if (!rest) {
        return {
            type: "error",
            message: 'query requires a metric name.\nUsage: query <metric> [by <dim>, ...] [where <cond>] [order by <field>] [limit <n>]\nType "query help" for full syntax.',
        };
    }
    if (rest.toLowerCase() === "help") {
        return { type: "help", command: "query" };
    }
    // Tokenize: split by whitespace but preserve quoted strings
    const tokens = tokenize(rest);
    if (tokens.length === 0) {
        return { type: "error", message: "query requires a metric name." };
    }
    const metric = tokens[0];
    let pos = 1;
    const query = { metric };
    // Parse clauses in order: by, where, order by, limit
    while (pos < tokens.length) {
        const token = tokens[pos].toLowerCase();
        if (token === "by") {
            pos++;
            const result = parseGroupBy(tokens, pos);
            if ("error" in result)
                return { type: "error", message: result.error };
            query.groupBy = result.clauses;
            pos = result.nextPos;
        }
        else if (token === "where") {
            pos++;
            const result = parseWhere(tokens, pos);
            if ("error" in result)
                return { type: "error", message: result.error };
            query.where = result.clauses;
            pos = result.nextPos;
        }
        else if (token === "order" && pos + 1 < tokens.length && tokens[pos + 1].toLowerCase() === "by") {
            pos += 2;
            const result = parseOrderBy(tokens, pos);
            if ("error" in result)
                return { type: "error", message: result.error };
            query.orderBy = result.clauses;
            pos = result.nextPos;
        }
        else if (token === "limit") {
            pos++;
            if (pos >= tokens.length) {
                return { type: "error", message: "limit requires a number." };
            }
            const n = parseInt(tokens[pos], 10);
            if (isNaN(n) || n < 0) {
                return { type: "error", message: `Invalid limit value: "${tokens[pos]}"` };
            }
            query.limit = n;
            pos++;
        }
        else {
            return { type: "error", message: `Unexpected token "${tokens[pos]}" in query. Type "query help" for syntax.` };
        }
    }
    return { type: "query", query };
}
function parseGroupBy(tokens, pos) {
    const clauses = [];
    while (pos < tokens.length) {
        const token = tokens[pos].toLowerCase();
        // Stop if we hit a keyword
        if (token === "where" || token === "order" || token === "limit")
            break;
        // Remove trailing comma if present
        let dimStr = tokens[pos];
        if (dimStr.endsWith(",")) {
            dimStr = dimStr.slice(0, -1);
        }
        if (!dimStr) {
            pos++;
            continue;
        }
        // Check for grain: dim:grain
        const colonIdx = dimStr.indexOf(":");
        if (colonIdx !== -1) {
            const dimension = dimStr.slice(0, colonIdx);
            const grain = dimStr.slice(colonIdx + 1).toLowerCase();
            if (!VALID_GRAINS.has(grain)) {
                return { error: `Invalid time grain "${grain}". Valid grains: day, week, month, quarter, year` };
            }
            clauses.push({ dimension, grain: grain });
        }
        else {
            clauses.push({ dimension: dimStr });
        }
        pos++;
    }
    if (clauses.length === 0) {
        return { error: "by requires at least one dimension." };
    }
    return { clauses, nextPos: pos };
}
function parseWhere(tokens, pos) {
    const clauses = [];
    while (pos < tokens.length) {
        const token = tokens[pos].toLowerCase();
        // Stop if we hit a non-where keyword
        if (token === "order" || token === "limit")
            break;
        // Skip "and" between conditions
        if (token === "and") {
            pos++;
            continue;
        }
        // Expect: dimension operator value
        if (pos + 2 >= tokens.length) {
            return { error: "Incomplete where clause. Expected: <dimension> <operator> <value>" };
        }
        const dimension = tokens[pos];
        const operator = tokens[pos + 1];
        let value = tokens[pos + 2];
        if (!VALID_OPERATORS.has(operator)) {
            return { error: `Invalid operator "${operator}". Valid operators: =, !=, >, <, >=, <=` };
        }
        // Strip quotes from value
        if ((value.startsWith("'") && value.endsWith("'")) ||
            (value.startsWith('"') && value.endsWith('"'))) {
            value = value.slice(1, -1);
        }
        // Try to parse as number
        const numValue = Number(value);
        const parsedValue = isNaN(numValue) ? value : numValue;
        clauses.push({
            dimension,
            operator: operator,
            value: parsedValue,
        });
        pos += 3;
    }
    if (clauses.length === 0) {
        return { error: "where requires at least one condition." };
    }
    return { clauses, nextPos: pos };
}
function parseOrderBy(tokens, pos) {
    if (pos >= tokens.length) {
        return { error: "order by requires a field name." };
    }
    const field = tokens[pos];
    pos++;
    let direction;
    if (pos < tokens.length) {
        const next = tokens[pos].toLowerCase();
        if (next === "desc") {
            direction = "desc";
            pos++;
        }
        else if (next === "asc") {
            direction = "asc";
            pos++;
        }
    }
    return {
        clauses: [{ field, direction }],
        nextPos: pos,
    };
}
/**
 * Tokenize input, keeping quoted strings as single tokens.
 */
function tokenize(input) {
    const tokens = [];
    let i = 0;
    while (i < input.length) {
        // Skip whitespace
        while (i < input.length && /\s/.test(input[i]))
            i++;
        if (i >= input.length)
            break;
        // Quoted string
        if (input[i] === "'" || input[i] === '"') {
            const quote = input[i];
            let j = i + 1;
            while (j < input.length && input[j] !== quote)
                j++;
            // Include the quotes in the token (they get stripped later)
            tokens.push(input.slice(i, j + 1));
            i = j + 1;
        }
        else {
            // Regular token
            let j = i;
            while (j < input.length && !/\s/.test(input[j]))
                j++;
            tokens.push(input.slice(i, j));
            i = j;
        }
    }
    return tokens;
}
