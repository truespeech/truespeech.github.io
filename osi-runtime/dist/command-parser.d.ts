export type TimeGrain = "day" | "week" | "month" | "quarter" | "year";
export type WhereOperator = "=" | "!=" | ">" | "<" | ">=" | "<=";
export interface GroupByClause {
    dimension: string;
    grain?: TimeGrain;
}
export interface WhereClause {
    dimension: string;
    operator: WhereOperator;
    value: string | number;
}
export interface OrderByClause {
    field: string;
    direction?: "asc" | "desc";
}
export interface SemanticQuery {
    metric: string;
    groupBy?: GroupByClause[];
    where?: WhereClause[];
    orderBy?: OrderByClause[];
    limit?: number;
}
export type ParsedCommand = {
    type: "help";
    command?: string;
} | {
    type: "metrics";
} | {
    type: "dimensions";
    metric: string;
} | {
    type: "query";
    query: SemanticQuery;
} | {
    type: "error";
    message: string;
};
/**
 * Parse a CLI command string into a structured command object.
 */
export declare function parseCommand(input: string): ParsedCommand;
