CREATE TABLE orders (
    order_id      INTEGER PRIMARY KEY,
    order_date    DATE NOT NULL,
    region        VARCHAR(50) NOT NULL,
    product_tier  VARCHAR(20) NOT NULL,
    amount        DECIMAL(10, 2) NOT NULL
);
