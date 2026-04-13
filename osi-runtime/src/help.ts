export const HELP_MAIN = `Commands:
  metrics                  List all available metrics
  dimensions <metric>      List queryable dimensions for a metric
  query <metric> [...]     Query a metric (type "query help" for syntax)
  help                     Show this help message`;

export const HELP_QUERY = `Usage: query <metric> [by <dim>, ...] [where <cond>] [order by <field>] [limit <n>]

  <metric>                 Metric name (e.g. total_sales)
  by <dim>, ...            Group by dimensions, comma-separated
                           Use <dim>:<grain> for time dimensions
                           Grains: day, week, month, quarter, year
  where <dim> <op> <value>
                           Filter results. Operators: =, !=, >, <, >=, <=
                           String values in single quotes: region = 'northeast'
                           Multiple conditions joined with "and"
  order by <field> [desc]  Sort results
  limit <n>                Limit number of rows

Examples:
  query total_sales
  query total_sales by region
  query total_sales by order_date:week
  query total_sales by region, product_tier
  query total_sales by region where product_tier = 'enterprise'
  query total_sales by order_date:month order by total_sales desc limit 5`;

export const HELP_SQL = `Type any SQL statement to execute against the database.
Examples:
  SELECT * FROM orders LIMIT 5
  SELECT COUNT(*) FROM orders
  SELECT region, SUM(amount) FROM orders GROUP BY region`;
