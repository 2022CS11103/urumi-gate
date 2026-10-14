export interface Product {
  id: number;
  name: string;
  price: string;
  status: string;
  sku: string;
  permalink: string;
}

export interface OrderItem {
  name: string;
  qty: number;
  total: string;
}

export interface Order {
  id: number;
  number: string;
  status: string;
  total: string;
  currency: string;
  created: string;
  customer: string;
  items: OrderItem[];
}

export interface WooStore {
  listProducts(query: { search?: string; perPage: number }): Promise<Product[]>;
  createProduct(input: { name: string; regularPrice: string; description?: string; sku?: string }): Promise<Product>;
  listOrders(query: { after?: string; before?: string; status?: string; perPage: number }): Promise<Order[]>;
  getOrder(id: number): Promise<Order | null>;
  updateOrderStatus(id: number, status: string): Promise<Order>;
}

export const ORDER_STATUSES = [
  "pending",
  "processing",
  "on-hold",
  "completed",
  "cancelled",
  "refunded",
  "failed",
] as const;

export function formatProducts(products: Product[]): string {
  if (products.length === 0) return "No products matched.";
  return [
    `${products.length} product${products.length === 1 ? "" : "s"}.`,
    ...products.map((product) => `#${product.id} ${product.name} · USD ${product.price} · ${product.status}`),
  ].join("\n");
}

export function formatProductCreated(product: Product): string {
  return `Created product #${product.id} "${product.name}" at USD ${product.price}. Status: ${product.status}.`;
}

export function formatOrders(orders: Order[]): string {
  if (orders.length === 0) return "No orders matched.";
  return [
    `${orders.length} order${orders.length === 1 ? "" : "s"}.`,
    ...orders.map((order) => {
      const items = order.items.map((item) => `${item.name} x${item.qty}`).join(", ") || "no items";
      return `#${order.number} ${order.status} · ${order.currency} ${order.total} · ${order.created} · ${items} · ${order.customer || "guest"}`;
    }),
  ].join("\n");
}

export function formatOrder(order: Order): string {
  return formatOrders([order]);
}

function money(value: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  return amount.toFixed(2);
}

export class FixtureStore implements WooStore {
  private products: Product[];
  private orders: Order[];
  private nextProduct: number;
  private nextOrder: number;

  constructor() {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    this.products = [
      {
        id: 101,
        name: "Linen Apron",
        price: "28.00",
        status: "publish",
        sku: "APRON-LINEN",
        permalink: "/product/linen-apron",
      },
      {
        id: 102,
        name: "Cast Iron Pan",
        price: "54.00",
        status: "publish",
        sku: "PAN-IRON",
        permalink: "/product/cast-iron-pan",
      },
    ];
    this.orders = [
      {
        id: 501,
        number: "501",
        status: "processing",
        total: "28.00",
        currency: "USD",
        created: today.toISOString(),
        customer: "Ada Lovelace",
        items: [{ name: "Linen Apron", qty: 1, total: "28.00" }],
      },
      {
        id: 480,
        number: "480",
        status: "completed",
        total: "54.00",
        currency: "USD",
        created: yesterday.toISOString(),
        customer: "Grace Hopper",
        items: [{ name: "Cast Iron Pan", qty: 1, total: "54.00" }],
      },
    ];
    this.nextProduct = 103;
    this.nextOrder = 502;
  }

  async listProducts(query: { search?: string; perPage: number }): Promise<Product[]> {
    const search = query.search?.toLowerCase();
    return this.products
      .filter((product) => !search || product.name.toLowerCase().includes(search) || product.sku.toLowerCase().includes(search))
      .slice(0, query.perPage);
  }

  async createProduct(input: { name: string; regularPrice: string; description?: string; sku?: string }): Promise<Product> {
    const product: Product = {
      id: this.nextProduct++,
      name: input.name,
      price: money(input.regularPrice),
      status: "publish",
      sku: input.sku ?? "",
      permalink: `/product/${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    };
    this.products.unshift(product);
    return product;
  }

  async listOrders(query: { after?: string; before?: string; status?: string; perPage: number }): Promise<Order[]> {
    return this.orders
      .filter((order) => !query.status || order.status === query.status)
      .filter((order) => !query.after || order.created >= query.after)
      .filter((order) => !query.before || order.created <= query.before)
      .slice(0, query.perPage);
  }

  async getOrder(id: number): Promise<Order | null> {
    return this.orders.find((order) => order.id === id) ?? null;
  }

  async updateOrderStatus(id: number, status: string): Promise<Order> {
    const order = await this.getOrder(id);
    if (!order) throw new Error(`order ${id} was not found`);
    order.status = status;
    return order;
  }

  placeOrder(productId: number, customer: string): Order {
    const product = this.products.find((item) => item.id === productId);
    if (!product) throw new Error(`product ${productId} was not found`);
    const order: Order = {
      id: this.nextOrder++,
      number: String(this.nextOrder - 1),
      status: "processing",
      total: product.price,
      currency: "USD",
      created: new Date().toISOString(),
      customer,
      items: [{ name: product.name, qty: 1, total: product.price }],
    };
    this.orders.unshift(order);
    return order;
  }
}

interface WooRawProduct {
  id: number;
  name: string;
  price?: string;
  regular_price?: string;
  status?: string;
  sku?: string;
  permalink?: string;
}

interface WooRawOrder {
  id: number;
  number?: string;
  status?: string;
  total?: string;
  currency?: string;
  date_created?: string;
  billing?: { first_name?: string; last_name?: string };
  line_items?: Array<{ name?: string; quantity?: number; total?: string }>;
}

function asProduct(raw: WooRawProduct): Product {
  return {
    id: raw.id,
    name: raw.name,
    price: money(raw.price || raw.regular_price || "0"),
    status: raw.status ?? "publish",
    sku: raw.sku ?? "",
    permalink: raw.permalink ?? "",
  };
}

function asOrder(raw: WooRawOrder): Order {
  const first = raw.billing?.first_name ?? "";
  const last = raw.billing?.last_name ?? "";
  return {
    id: raw.id,
    number: String(raw.number ?? raw.id),
    status: raw.status ?? "pending",
    total: money(raw.total ?? "0"),
    currency: raw.currency ?? "USD",
    created: raw.date_created ? new Date(raw.date_created).toISOString() : "",
    customer: `${first} ${last}`.trim(),
    items: (raw.line_items ?? []).map((item) => ({
      name: item.name ?? "item",
      qty: item.quantity ?? 1,
      total: money(item.total ?? "0"),
    })),
  };
}

export class WooRestStore implements WooStore {
  private readonly baseUrl: string;
  private readonly consumerKey: string;
  private readonly consumerSecret: string;

  constructor(baseUrl: string, consumerKey: string, consumerSecret: string) {
    this.baseUrl = baseUrl;
    this.consumerKey = consumerKey;
    this.consumerSecret = consumerSecret;
  }

  private async request<T>(path: string, method: string, body?: unknown): Promise<T> {
    const url = new URL(path.replace(/^\//, ""), this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`);
    const response = await fetch(url, {
      method,
      headers: {
        authorization: `Basic ${Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString("base64")}`,
        "content-type": "application/json",
        "x-urumi-internal": "1",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`WooCommerce ${response.status}: ${text.slice(0, 400)}`);
    }
    return text ? (JSON.parse(text) as T) : (null as T);
  }

  async listProducts(query: { search?: string; perPage: number }): Promise<Product[]> {
    const params = new URLSearchParams({ per_page: String(query.perPage), status: "publish" });
    if (query.search) params.set("search", query.search);
    const rows = await this.request<WooRawProduct[]>(`products?${params}`, "GET");
    return rows.map(asProduct);
  }

  async createProduct(input: { name: string; regularPrice: string; description?: string; sku?: string }): Promise<Product> {
    const created = await this.request<WooRawProduct>("products", "POST", {
      name: input.name,
      type: "simple",
      regular_price: money(input.regularPrice),
      description: input.description ?? "",
      sku: input.sku ?? "",
      status: "publish",
      catalog_visibility: "visible",
      manage_stock: false,
      stock_status: "instock",
    });
    return asProduct(created);
  }

  async listOrders(query: { after?: string; before?: string; status?: string; perPage: number }): Promise<Order[]> {
    const params = new URLSearchParams({ per_page: String(query.perPage) });
    if (query.after) params.set("after", query.after);
    if (query.before) params.set("before", query.before);
    if (query.status) params.set("status", query.status);
    const rows = await this.request<WooRawOrder[]>(`orders?${params}`, "GET");
    return rows.map(asOrder);
  }

  async getOrder(id: number): Promise<Order | null> {
    try {
      const row = await this.request<WooRawOrder>(`orders/${id}`, "GET");
      return asOrder(row);
    } catch (error) {
      if (error instanceof Error && error.message.includes("404")) return null;
      throw error;
    }
  }

  async updateOrderStatus(id: number, status: string): Promise<Order> {
    const row = await this.request<WooRawOrder>(`orders/${id}`, "PUT", { status });
    return asOrder(row);
  }
}
