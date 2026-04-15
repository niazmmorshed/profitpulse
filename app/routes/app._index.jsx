import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const response = await admin.graphql(`
    #graphql
    query getShopAndProducts {
      shop {
        name
        currencyCode
        myshopifyDomain
      }
      products(first: 10) {
        edges {
          node {
            id
            title
            totalInventory
            variants(first: 1) {
              edges {
                node {
                  price
                }
              }
            }
          }
        }
      }
    }
  `);

  const data = await response.json();
  const shop = data.data.shop;
  const products = data.data.products.edges.map(e => e.node);

  // Load saved costs from database
  const savedCosts = await db.productCost.findMany({
    where: { shop: session.shop }
  });
  const costsMap = {};
  savedCosts.forEach(c => { costsMap[c.productId] = c.cost; });

  const SHOPIFY_FEE_RATE = 0.029;
  const SHOPIFY_FEE_FIXED = 0.30;

  const processedProducts = products.map(product => {
    const price = parseFloat(product.variants.edges[0]?.node.price || 0);
    const savedCost = costsMap[product.id];
    const cogs = savedCost != null ? savedCost : price * 0.4;
    const fees = price * SHOPIFY_FEE_RATE + SHOPIFY_FEE_FIXED;
    const profit = price - cogs - fees;
    const margin = price > 0 ? ((profit / price) * 100).toFixed(1) : 0;
    const isEstimated = savedCost == null;

    return {
      id: product.id,
      title: product.title,
      stock: product.totalInventory,
      price: price.toFixed(2),
      cogs: cogs.toFixed(2),
      profit: profit.toFixed(2),
      margin,
      isEstimated,
    };
  });

  const totalProfit = processedProducts.reduce((sum, p) => sum + parseFloat(p.profit), 0);
  const avgMargin = processedProducts.length > 0
    ? (processedProducts.reduce((sum, p) => sum + parseFloat(p.margin), 0) / processedProducts.length).toFixed(1)
    : 0;

  return { shop, products: processedProducts, totalProfit: totalProfit.toFixed(2), avgMargin };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const productId = formData.get("productId");
  const cost = parseFloat(formData.get("cost"));

  if (!productId || isNaN(cost) || cost < 0) {
    return { error: "Invalid cost value" };
  }

  await db.productCost.upsert({
    where: { shop_productId: { shop: session.shop, productId } },
    update: { cost },
    create: { shop: session.shop, productId, cost },
  });

  return { success: true };
};

export default function Index() {
  const { shop, products, totalProfit, avgMargin } = useLoaderData();
  const fetcher = useFetcher();

  return (
    <s-page heading="ProfitPulse Dashboard">

      <s-section heading="Store overview">
        <s-stack direction="inline" gap="loose">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="tight">
              <s-text tone="subdued">Store</s-text>
              <s-text>{shop.name}</s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="tight">
              <s-text tone="subdued">Est. total profit</s-text>
              <s-heading>${totalProfit}</s-heading>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="tight">
              <s-text tone="subdued">Avg margin</s-text>
              <s-heading>{avgMargin}%</s-heading>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="tight">
              <s-text tone="subdued">Products</s-text>
              <s-heading>{products.length}</s-heading>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      <s-section heading="Product profit breakdown">
        <s-stack direction="block" gap="base">
          {products.map(product => (
            <s-box key={product.id} padding="base" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="tight">

                <s-stack direction="inline" gap="loose">
                  <s-text>{product.title}</s-text>
                  <s-text tone="subdued">Stock: {product.stock}</s-text>
                </s-stack>

                <s-stack direction="inline" gap="loose">
                  <s-box padding="tight" borderWidth="base" borderRadius="base">
                    <s-stack direction="block" gap="extraTight">
                      <s-text tone="subdued">Price</s-text>
                      <s-text>${product.price}</s-text>
                    </s-stack>
                  </s-box>
                  <s-box padding="tight" borderWidth="base" borderRadius="base">
                    <s-stack direction="block" gap="extraTight">
                      <s-text tone="subdued">Your cost</s-text>
                      <s-text>
                        ${product.cogs}
                        {product.isEstimated ? " (estimated)" : ""}
                      </s-text>
                    </s-stack>
                  </s-box>
                  <s-box padding="tight" borderWidth="base" borderRadius="base">
                    <s-stack direction="block" gap="extraTight">
                      <s-text tone="subdued">Profit/unit</s-text>
                      <s-text>{parseFloat(product.profit) >= 0 ? "$" + product.profit : "-$" + Math.abs(parseFloat(product.profit)).toFixed(2)}</s-text>
                    </s-stack>
                  </s-box>
                  <s-box padding="tight" borderWidth="base" borderRadius="base">
                    <s-stack direction="block" gap="extraTight">
                      <s-text tone="subdued">Margin</s-text>
                      <s-text>{product.margin}%</s-text>
                    </s-stack>
                  </s-box>
                </s-stack>

                <fetcher.Form method="post">
                  <input type="hidden" name="productId" value={product.id} />
                  <s-stack direction="inline" gap="tight">
                    <s-text tone="subdued">Enter your real cost: $</s-text>
                    <input
                      type="number"
                      name="cost"
                      min="0"
                      step="0.01"
                      defaultValue={product.isEstimated ? "" : product.cogs}
                      placeholder="e.g. 25.00"
                      style={{ width: "100px", padding: "4px 8px", borderRadius: "6px", border: "1px solid #ccc" }}
                    />
                    <button type="submit" style={{ padding: "6px 14px", borderRadius: "6px", border: "1px solid #ccc", cursor: "pointer", background: "#008060", color: "white" }}>Save cost</button>
                  </s-stack>
                </fetcher.Form>

              </s-stack>
            </s-box>
          ))}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="How it works">
        <s-paragraph>
          Enter your real product cost to get accurate profit numbers.
        </s-paragraph>
        <s-paragraph>
          Until you enter a cost, we estimate 40% of the selling price.
        </s-paragraph>
        <s-paragraph>
          Shopify fees (2.9% + $0.30) are automatically deducted.
        </s-paragraph>
      </s-section>

    </s-page>
  );
}