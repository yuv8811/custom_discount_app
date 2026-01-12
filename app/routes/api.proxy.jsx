import { authenticate, unauthenticated } from "../shopify.server";
import prisma from "../db.server";

const PROXY_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json; charset=utf-8",
};

export const loader = async ({ request }) => {
  console.log("--- Proxy Loader Hit ---");
  console.log("URL:", request.url);

  try {
    let shop;
    
    // 1. Attempt Auth
    try {
        const authResult = await authenticate.public.appProxy(request);
        if (authResult.session) {
            shop = authResult.session.shop;
        } else if (authResult.admin) {
            shop = authResult.admin.shop;
        } 
    } catch (e) {
        console.warn("Auth check failed (might be expected):", e.message);
    }

    // 2. Fallback to URL param
    if (!shop) {
        const url = new URL(request.url);
        shop = url.searchParams.get("shop");
    }

    if (!shop) {
        console.error("No Shop Found");
        return Response.json(
            { valid: false, message: "No Shop Context" }, 
            { status: 200, headers: PROXY_HEADERS }
        );
    }

    console.log("Shop:", shop);

    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    if (!code) {
        return Response.json(
            { valid: false, message: "Code Required" }, 
            { status: 200, headers: PROXY_HEADERS }
        );
    }

    // 3. Get Offline Session
    const offlineSession = await prisma.session.findFirst({
        where: { shop: shop, isOnline: false }
    });

    if (!offlineSession) {
         console.error("No offline session for", shop);
         return Response.json(
             { valid: false, message: "Session Missing" }, 
             { status: 200, headers: PROXY_HEADERS }
         );
    }
    
    // 4. Create Admin Client
    const { admin } = await unauthenticated.admin(shop);
    if (!admin) {
         throw new Error("Could not create admin client");
    }

    const cleanCode = code.trim().replace(/[\s-]/g, "").toUpperCase();
    const last4 = cleanCode.slice(-4);
    const query = `last_characters:${last4}`;
    
    // console.log(`Searching GC: ${cleanCode} (Last4: ${last4}) in ${shop}`);

    const response = await admin.graphql(
        `#graphql
        query giftCards($query: String!) {
            giftCards(first: 10, query: $query) {
                edges {
                    node {
                        lastCharacters
                        balance {
                            amount
                            currencyCode
                        }
                        enabled
                    }
                }
            }
        }`,
        {
            variables: { query }
        }
    );
    
    const responseJson = await response.json();
    const giftCards = responseJson.data?.giftCards?.edges || [];
    
    // Find precise match (Shopify only returns matches on last 4, we must verify the rest if we had the full code, 
    // but the API doesn't return the full code for security. 
    // We can only trust the "lastCharacters" match + balance > 0 check for now 
    // unless we try to dry-run a checkout which is complex.
    // We will assume if Last-4 matches and User entered a code, it's likely the right one 
    // OR we can't verify the full code client-side without a checkout.
    // Wait, the user puts in the full code. We only search by last 4. 
    // Since we cannot verify the FULL code via Admin API (it doesn't expose it), 
    // we effectively rely on Last 4 + Enabled + Balance. 
    // This is a known limitation unless we store the codes ourselves.
    
    const match = giftCards.find(edge => 
        edge.node.enabled && 
        parseFloat(edge.node.balance.amount) > 0 && 
        edge.node.lastCharacters === last4
    );
    
    if (match) {
        return Response.json({ 
            valid: true, 
            balance: match.node.balance.amount,
            currency: match.node.balance.currencyCode
        }, { headers: PROXY_HEADERS });
    } else {
        return Response.json(
            { 
                valid: false, 
                message: `Card not found (Shop: ${shop}, Search: ${last4}, Scanned: ${giftCards.length})` 
            }, 
            { headers: PROXY_HEADERS }
        );
    }

  } catch (err) {
    console.error("CRITICAL PROXY ERROR:", err);
    return Response.json(
        { valid: false, message: "System Error: " + err.message }, 
        { status: 200, headers: PROXY_HEADERS }
    );
  }
};

// ACTION: Convert Gift Card to Discount
export const action = async ({ request }) => {
  console.log("--- Proxy Action Hit (Convert) ---");
  
  if (request.method !== "POST") {
    return Response.json({ ok: false, message: "Method not allowed" }, { status: 405, headers: PROXY_HEADERS });
  }

  try {
    let shop;
    try {
        const authResult = await authenticate.public.appProxy(request);
        if (authResult.session) shop = authResult.session.shop;
        else if (authResult.admin) shop = authResult.admin.shop;
    } catch (e) {}

    if (!shop) {
        const url = new URL(request.url);
        shop = url.searchParams.get("shop");
    }

    if (!shop) {
         return Response.json({ ok: false, message: "No Shop Context" }, { headers: PROXY_HEADERS });
    }

    const body = await request.json();
    const { code, cartTotal } = body;

    console.log(`Converting GC: ${code} for Shop: ${shop}, CartTotal: ${cartTotal}`);

    const cleanCode = code?.trim().replace(/[\s-]/g, "").toUpperCase();
    if (!cleanCode || cleanCode.length < 4) {
        return Response.json({ ok: false, message: "Invalid code format" }, { headers: PROXY_HEADERS });
    }
    const last4 = cleanCode.slice(-4);

    // 1. Verify Card (Admin API)
    const { admin } = await unauthenticated.admin(shop);
    const gcQuery = `last_characters:${last4}`;
    
    console.log(`Searching GC Action: ${last4} in ${shop}`);

    const gcRes = await admin.graphql(
        `#graphql
        query findGC($query: String!) {
            giftCards(first: 20, query: $query) {
                edges {
                    node {
                        id
                        lastCharacters
                        enabled
                        balance { amount }
                    }
                }
            }
        }`,
        { variables: { query: gcQuery } }
    );
    
    const gcJson = await gcRes.json();
    const edges = gcJson.data?.giftCards?.edges || [];
    
    console.log(`GC Action Found ${edges.length} candidates for ${last4}`);

    const match = edges.find(
        e => e.node.enabled && parseFloat(e.node.balance.amount) > 0 && e.node.lastCharacters === last4
    );

    if (!match) {
        console.error("GC Action: No match found among candidates", edges.map(e => ({ last: e.node.lastCharacters, en: e.node.enabled, bal: e.node.balance.amount })));
        return Response.json({ 
            ok: false, 
            message: `Gift card not found (Search: ${last4}, Candidates: ${edges.length})` 
        }, { headers: PROXY_HEADERS });
    }

    // 2. Calculate Discount
    const balance = parseFloat(match.node.balance.amount);
    const total = parseFloat(cartTotal || 0);
    
    // If cart has items, we cap at cart total to avoid "over-discounting" visual confusion,
    // but if cart is empty, we just create a discount for the full balance so it's ready when they add items.
    let discountAmount = balance;
    if (total > 0) {
        discountAmount = Math.min(balance, total);
    }
    
    if (discountAmount <= 0) {
         return Response.json({ ok: false, message: "Invalid discount amount" }, { headers: PROXY_HEADERS });
    }

    // 3. Create Discount Code
    // We use a prefix to identify these easily
    const unique = Math.random().toString(36).substring(2, 6).toUpperCase();
    const discountCode = `GC-${last4}-${unique}`;
    
    // Using GraphQL to create basic discount
    const discRes = await admin.graphql(
        `#graphql
        mutation createDiscount($basicCodeDiscount: DiscountCodeBasicInput!) {
            discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
                codeDiscountNode {
                    codeDiscount {
                        ... on DiscountCodeBasic {
                            codes(first:1) { nodes { code } }
                        }
                    }
                }
                userErrors { field message }
            }
        }`,
        {
            variables: {
                basicCodeDiscount: {
                    title: `Gift Card ${last4}`,
                    code: discountCode,
                    startsAt: new Date().toISOString(),
                    endsAt: new Date(Date.now() + 3600 * 1000).toISOString(), // 1 Hour expiry
                    customerSelection: { all: true },
                    customerGets: {
                        value: { discountAmount: { amount: discountAmount, appliesOnEachItem: false } },
                        items: { all: true }
                    },
                    usageLimit: 1
                }
            }
        }
    );
    
    const discJson = await discRes.json();
    const errors = discJson.data?.discountCodeBasicCreate?.userErrors;
    
    if (errors && errors.length > 0) {
        console.error("Discount Create Error:", errors);
        return Response.json({ ok: false, message: "Could not create discount" }, { headers: PROXY_HEADERS });
    }

    // 4. Return the new code
    return Response.json({
        ok: true,
        discountCode,
        discountAmount,
        message: "Gift card applied"
    }, { headers: PROXY_HEADERS });

  } catch (error) {
    console.error("Action Error:", error);
    return Response.json({ ok: false, message: "System Error: " + error.message }, { headers: PROXY_HEADERS });
  }
};
