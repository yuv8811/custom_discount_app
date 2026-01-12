import { useLoaderData, Form, useActionData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useState, useEffect } from "react";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  /*
  const response = await admin.graphql(
    `#graphql
    query {
      shop {
        currencyCode
      }
      giftCards(first: 20, reverse: true) {
        edges {
          node {
            id
            lastCharacters
            initialValue {
              amount
              currencyCode
            }
            balance {
              amount
              currencyCode
            }
            enabled
          }
        }
      }
    }`
  );
  */
  // Reverting to original query without debug
  const response = await admin.graphql(
    `#graphql
    query {
      shop {
        currencyCode
      }
      giftCards(first: 20, reverse: true) {
        edges {
          node {
            id
            lastCharacters
            initialValue {
              amount
              currencyCode
            }
            balance {
              amount
              currencyCode
            }
            enabled
          }
        }
      }
    }`
  );
  const responseJson = await response.json();
  
  return {
    shop: responseJson.data.shop,
    giftCards: responseJson.data.giftCards.edges
  };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const code = formData.get("code");
  const amount = formData.get("amount");

  if (!code || !amount) {
    return { error: "Code and amount are required" };
  }

  const response = await admin.graphql(
    `#graphql
    mutation giftCardCreate($input: GiftCardCreateInput!) {
      giftCardCreate(input: $input) {
        giftCard {
            id
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        input: {
          code: code,
          initialValue: amount
        }
      }
    }
  );

  const responseJson = await response.json();
  if (responseJson.data.giftCardCreate.userErrors?.length > 0) {
      return { error: responseJson.data.giftCardCreate.userErrors[0].message };
  }
  return { success: true };
};

export default function GiftCardPage() {
  const { giftCards, shop } = useLoaderData();
  const actionData = useActionData();
  const nav = useNavigation();
  const isSubmitting = nav.state === "submitting";

  const [code, setCode] = useState("");
  const [amount, setAmount] = useState("");

  useEffect(() => {
    if (actionData?.success) {
      setCode("");
      setAmount("");
    }
  }, [actionData]);

  return (
    <s-page heading="Gift Cards">
      <s-section heading="Create Manual Gift Card">
        {actionData?.error && (
            <s-box padding="base" style={{background: '#ffebee', color: '#c62828', marginBottom: '1rem', borderRadius: '4px'}}>
                {actionData.error}
            </s-box>
        )}
        {actionData?.success && (
            <s-box padding="base" style={{background: '#e8f5e9', color: '#2e7d32', marginBottom: '1rem', borderRadius: '4px'}}>
                Gift Card Created Successfully
            </s-box>
        )}
        
        <Form method="post">
           <input type="hidden" name="currency" value={shop?.currencyCode || 'USD'} />
           <s-stack direction="block" gap="base">
            <s-text-field
                name="code"
                label="Gift Card Code"
                value={code}
                onChange={(e) => setCode(e.currentTarget.value)} 
                autoComplete="off"
            ></s-text-field>
             <s-text-field
                name="amount"
                label="Amount"
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.currentTarget.value)}
                autoComplete="off"
            ></s-text-field>
            <s-button type="submit" loading={isSubmitting ? "true" : undefined}>Create Gift Card</s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading="Existing Gift Cards">
            <s-stack direction="block" gap="base">
             {giftCards.map(({ node }) => (
                 <s-box key={node.id} padding="base" border-width="base" border-radius="base" background="subdued">
                    <s-stack direction="inline" gap="base" align="center">
                        <s-text style={{fontWeight: 'bold', fontSize: '1.1em'}}>.... {node.lastCharacters}</s-text>
                        <s-text>Balance: {node.balance.amount} {node.balance.currencyCode}</s-text>
                        <s-text style={{color: node.enabled ? 'green' : 'gray'}}>{node.enabled ? "Active" : "Disabled"}</s-text>
                    </s-stack>
                 </s-box>
             ))}
             {giftCards.length === 0 && <s-text>No gift cards found.</s-text>}
            </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
