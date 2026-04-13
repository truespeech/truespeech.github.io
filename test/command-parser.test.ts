import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCommand } from "../osi-runtime/src/command-parser.js";
import type { ParsedCommand } from "../osi-runtime/src/command-parser.js";

describe("parseCommand", () => {
  describe("basic commands", () => {
    it("parses help", () => {
      const result = parseCommand("help");
      assert.deepEqual(result, { type: "help" });
    });

    it("parses metrics", () => {
      const result = parseCommand("metrics");
      assert.deepEqual(result, { type: "metrics" });
    });

    it("parses dimensions with metric name", () => {
      const result = parseCommand("dimensions total_sales");
      assert.deepEqual(result, { type: "dimensions", metric: "total_sales" });
    });

    it("returns error for dimensions without metric", () => {
      const result = parseCommand("dimensions");
      assert.equal(result.type, "error");
    });

    it("returns error for empty input", () => {
      const result = parseCommand("");
      assert.equal(result.type, "error");
    });

    it("returns error for whitespace-only input", () => {
      const result = parseCommand("   ");
      assert.equal(result.type, "error");
    });

    it("returns error for unknown command", () => {
      const result = parseCommand("blah");
      assert.equal(result.type, "error");
      assert.ok(
        (result as { type: "error"; message: string }).message.includes("Unknown command")
      );
    });
  });

  describe("query command — basic", () => {
    it("parses query with metric only", () => {
      const result = parseCommand("query total_sales");
      assert.equal(result.type, "query");
      const q = (result as { type: "query"; query: any }).query;
      assert.equal(q.metric, "total_sales");
      assert.equal(q.groupBy, undefined);
      assert.equal(q.where, undefined);
    });

    it("parses query help", () => {
      const result = parseCommand("query help");
      assert.deepEqual(result, { type: "help", command: "query" });
    });

    it("returns error for query with no metric", () => {
      const result = parseCommand("query");
      assert.equal(result.type, "error");
      assert.ok(
        (result as { type: "error"; message: string }).message.includes("metric name")
      );
    });
  });

  describe("query command — groupBy", () => {
    it("parses single non-time dimension", () => {
      const result = parseCommand("query total_sales by region");
      assert.equal(result.type, "query");
      const q = (result as { type: "query"; query: any }).query;
      assert.deepEqual(q.groupBy, [{ dimension: "region" }]);
    });

    it("parses multiple dimensions comma-separated", () => {
      const result = parseCommand("query total_sales by region, product_tier");
      assert.equal(result.type, "query");
      const q = (result as { type: "query"; query: any }).query;
      assert.deepEqual(q.groupBy, [
        { dimension: "region" },
        { dimension: "product_tier" },
      ]);
    });

    it("parses time dimension with grain", () => {
      const result = parseCommand("query total_sales by order_date:week");
      assert.equal(result.type, "query");
      const q = (result as { type: "query"; query: any }).query;
      assert.deepEqual(q.groupBy, [
        { dimension: "order_date", grain: "week" },
      ]);
    });

    it("parses mixed time and non-time dimensions", () => {
      const result = parseCommand("query total_sales by order_date:month, region");
      assert.equal(result.type, "query");
      const q = (result as { type: "query"; query: any }).query;
      assert.deepEqual(q.groupBy, [
        { dimension: "order_date", grain: "month" },
        { dimension: "region" },
      ]);
    });

    it("returns error for invalid grain", () => {
      const result = parseCommand("query total_sales by order_date:hourly");
      assert.equal(result.type, "error");
      assert.ok(
        (result as { type: "error"; message: string }).message.includes("Invalid time grain")
      );
    });
  });

  describe("query command — where", () => {
    it("parses single where clause with string value", () => {
      const result = parseCommand("query total_sales where region = 'northeast'");
      assert.equal(result.type, "query");
      const q = (result as { type: "query"; query: any }).query;
      assert.deepEqual(q.where, [
        { dimension: "region", operator: "=", value: "northeast" },
      ]);
    });

    it("parses multiple where clauses with and", () => {
      const result = parseCommand(
        "query total_sales where region = 'northeast' and product_tier = 'enterprise'"
      );
      assert.equal(result.type, "query");
      const q = (result as { type: "query"; query: any }).query;
      assert.deepEqual(q.where, [
        { dimension: "region", operator: "=", value: "northeast" },
        { dimension: "product_tier", operator: "=", value: "enterprise" },
      ]);
    });

    it("parses numeric where value", () => {
      const result = parseCommand("query total_sales where amount > 1000");
      assert.equal(result.type, "query");
      const q = (result as { type: "query"; query: any }).query;
      assert.deepEqual(q.where, [
        { dimension: "amount", operator: ">", value: 1000 },
      ]);
    });

    it("parses != operator", () => {
      const result = parseCommand("query total_sales where region != 'west'");
      assert.equal(result.type, "query");
      const q = (result as { type: "query"; query: any }).query;
      assert.equal(q.where[0].operator, "!=");
    });
  });

  describe("query command — groupBy + where", () => {
    it("parses groupBy followed by where", () => {
      const result = parseCommand(
        "query total_sales by region where product_tier = 'enterprise'"
      );
      assert.equal(result.type, "query");
      const q = (result as { type: "query"; query: any }).query;
      assert.deepEqual(q.groupBy, [{ dimension: "region" }]);
      assert.deepEqual(q.where, [
        { dimension: "product_tier", operator: "=", value: "enterprise" },
      ]);
    });
  });

  describe("query command — order by and limit", () => {
    it("parses order by desc", () => {
      const result = parseCommand("query total_sales order by total_sales desc");
      assert.equal(result.type, "query");
      const q = (result as { type: "query"; query: any }).query;
      assert.deepEqual(q.orderBy, [{ field: "total_sales", direction: "desc" }]);
    });

    it("parses order by without direction (default)", () => {
      const result = parseCommand("query total_sales order by region");
      assert.equal(result.type, "query");
      const q = (result as { type: "query"; query: any }).query;
      assert.deepEqual(q.orderBy, [{ field: "region", direction: undefined }]);
    });

    it("parses limit", () => {
      const result = parseCommand("query total_sales limit 5");
      assert.equal(result.type, "query");
      const q = (result as { type: "query"; query: any }).query;
      assert.equal(q.limit, 5);
    });

    it("parses all clauses combined", () => {
      const result = parseCommand(
        "query total_sales by region order by total_sales desc limit 3"
      );
      assert.equal(result.type, "query");
      const q = (result as { type: "query"; query: any }).query;
      assert.equal(q.metric, "total_sales");
      assert.deepEqual(q.groupBy, [{ dimension: "region" }]);
      assert.deepEqual(q.orderBy, [{ field: "total_sales", direction: "desc" }]);
      assert.equal(q.limit, 3);
    });
  });
});
