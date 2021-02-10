import { addTag, isSameDescription, isSameTags, mergeDescriptions, mergeTags, removeTag } from "./index";

const { VEND_CPT_OUTLET_ID, VEND_JHB_OUTLET_ID, SHOPIFY_CPT_OUTLET_ID, SHOPIFY_JHB_OUTLET_ID } = process.env;

export type productModel = {
  [key: string]: any
  vend_id?: string,
  vend_unpublished?: boolean
  product_id: number
  variant_id: number
  tags: string | null
  has_variants?: boolean
  name?: string
  title?: string
  description: string
  price: string
  sku: string
  product_type?: string
  option1?: string
  option2?: string
  option3?: string
  inventory_item_id?: number
  inventory_CPT?: number
  inventory_JHB?: number
  inventory_quantity?: number
  inventory_policy?: "continue" | "deny",
  image_id?: number
  s_status?: "active" | "draft" | "archived"
  v_all_inactive?: boolean
  v_all_unpublished?: boolean
  v_incorrectly_unpublished?: boolean
  v_description?: string
  v_inconsistent_description?: boolean
  v_tags?: string
  v_inconsistent_tags?: boolean
  v_has_sell_jhb_tag?: boolean
  v_has_needs_variant_image_tag?: boolean
  v_single_product?: boolean
  s_has_jhb_inventory?: boolean
};

export const createGqlQuery = (product_id: number): string => {
  return `{
    product(id: "gid://shopify/Product/${product_id}") {
      id
      status
      productType
      descriptionHtml
      tags
      featuredImage {
        id
      }
      variants(first: 32) {
        edges {
          node {
            id
            image {
              id
            }
            inventoryQuantity
            price
            sku
            selectedOptions {
              value
            }
            inventoryItem {
              id
              inventoryLevels(first: 2) {
                edges {
                  node {
                    id
                    available
                    location {
                      id
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }`;
};

export const createGqlNewProductMutation = (
  product_id: number,
  sku: string,
  price: string,
  inventory_CPT: number,
  inventory_JHB?: number,
  option1?: string,
  option2?: string,
  option3?: string,
): string => {
  const inventoryQuantities = [{ availableQuantity: inventory_CPT, locationId: "gid://shopify/Location/22530642" }];
  inventory_JHB
  && inventoryQuantities.push({ availableQuantity: inventory_JHB, locationId: "gid://shopify/Location/36654383164" });

  const config = {
    productId: `gid://shopify/Product/${product_id}`,
    sku,
    options: [option1 || "", option2 || "", option3 || ""],
    price,
    inventoryQuantities,
  };

  return `mutation {productVariantCreate(input: ${JSON.stringify(config)}) {
    product {
      id
    }
    productVariant {
      id
    }
    userErrors {
      field
      message
    }
  }
}`;
};

export const isUnpublished = (({ source_id, variant_source_id }: any): boolean => {
  return source_id.includes("unpub") || variant_source_id.includes("unpub");
});

export const isInactive = (({ active }: any): boolean => !active);

export const hasVariantImage = (({ image_id, node }: productModel): boolean => !!image_id || !!node?.image);

export const simplifyProducts = ((products: any, source: "vend" | "shopify" | "shopify_gql"): productModel[] => {
  if (source === "vend") {
    const v_all_inactive = products.every(isInactive);
    const v_all_unpublished = products.every(isUnpublished);
    const v_incorrectly_unpublished = !v_all_unpublished && products.some(isUnpublished);
    const v_description = products.reduce((acc, { description: d }) => { return mergeDescriptions(acc, d); }, "");
    const v_tags = products.reduce((acc, { tags }) => { return mergeTags(acc, tags); }, "");
    const v_inconsistent_tags = !products.every(({ tags }) => isSameTags(tags, v_tags));
    const v_has_sell_jhb_tag = v_tags.toLowerCase().includes("sell jhb");
    const v_has_needs_variant_image_tag = v_tags.toLowerCase().includes("fx_needs_variant_image");
    const v_single_product = products.length === 1;

    return products.reduce((acc: productModel[], variant: productModel): productModel[] => {
      const {
        id,
        active,
        source_id,
        variant_source_id,
        price,
        tax,
        sku,
        type,
        variant_option_one_value,
        variant_option_two_value,
        variant_option_three_value,
        inventory,
        description,
      } = variant;

      const inventory_CPT = +inventory.filter(({ outlet_id }) => outlet_id === VEND_CPT_OUTLET_ID)[0]?.count || 0;
      const inventory_JHB = +inventory.filter(({ outlet_id }) => outlet_id === VEND_JHB_OUTLET_ID)[0]?.count || 0;
      const v_unpublished = source_id.includes("unpub") || variant_source_id.includes("unpub");

      acc.push({
        vend_id: id,
        product_id: +source_id.replace(/_unpub/gi, ""),
        variant_id: +variant_source_id.replace(/_unpub/gi, ""),
        tags: v_tags,
        description: v_description,
        price: (+price + +tax).toFixed(2),
        sku,
        product_type: type,
        option1: variant_option_one_value || null,
        option2: variant_option_two_value || null,
        option3: variant_option_three_value || null,
        inventory_item_id: undefined,
        inventory_CPT,
        inventory_JHB,
        inventory_quantity: inventory_CPT + inventory_JHB,
        inventory_policy: undefined,
        image_id: undefined,
        v_active: active,
        v_all_inactive,
        v_unpublished,
        v_all_unpublished,
        v_incorrectly_unpublished,
        v_inconsistent_description: description !== v_description,
        v_inconsistent_tags,
        v_has_sell_jhb_tag,
        v_has_needs_variant_image_tag,
        v_single_product,
      });

      return acc;
    }, []);
  }
  if (source === "shopify") {
    const { id, images, product_type, status, tags, variants, body_html } = products;
    const s_needs_variant_image = !products.variants.every(hasVariantImage);

    return variants.reduce((acc: productModel[], variant: productModel): productModel[] => {
      const {
        id: variant_id,
        price,
        sku,
        option1,
        option2,
        option3,
        inventory_quantity,
        inventory_item_id,
        inventory_policy,
        image_id,
      } = variant;

      acc.push({
        vend_id: undefined,
        vend_unpublished: undefined,
        product_id: id,
        variant_id,
        tags,
        description: body_html,
        price,
        sku,
        product_type,
        option1,
        option2,
        option3,
        inventory_item_id,
        inventory_CPT: undefined,
        inventory_JHB: undefined,
        inventory_quantity,
        inventory_policy,
        image_id,
        s_status: status,
        s_needs_variant_image,
      });

      return acc;
    }, []);
  }

  if (source === "shopify_gql") {
    const {
      id: s_gql_product_id,
      productType,
      status,
      descriptionHtml,
      tags: s_gql_tags,
      featuredImage,
      variants: { edges: variants },
    } = products;

    const s_needs_variant_image = !variants.every(hasVariantImage) || (variants.length === 1 && !featuredImage);
    const tags = s_gql_tags.join(",");

    return variants.reduce((acc: productModel[], { node: variant }: productModel): productModel[] => {
      const {
        id: s_gql_variant_id,
        price,
        sku,
        inventoryQuantity,
        inventoryItem: {
          id: s_gql_inventory_item_id,
          inventoryLevels: { edges: inventoryLevels },
        },
        inventory_policy,
        image,
        selectedOptions,
      } = variant;

      const inventory_CPT = inventoryLevels.filter(({ node: { location: { id } } }) => id.replace(
        "gid://shopify/Location/",
        "",
      ) === SHOPIFY_CPT_OUTLET_ID)[0]?.node?.available;
      const inventory_JHB = inventoryLevels.filter(({ node: { location: { id } } }) => id.replace(
        "gid://shopify/Location/",
        "",
      ) === SHOPIFY_JHB_OUTLET_ID)[0]?.node?.available;
      const s_has_jhb_inventory = inventoryLevels.filter(({ node: { location: { id } } }) => id.replace(
        "gid://shopify/Location/",
        "",
      ) === SHOPIFY_JHB_OUTLET_ID).length > 0;

      acc.push({
        vend_id: undefined,
        vend_unpublished: undefined,
        product_id: +s_gql_product_id.replace("gid://shopify/Product/", "") || null,
        variant_id: +s_gql_variant_id.replace("gid://shopify/ProductVariant/", "") || null,
        tags,
        description: descriptionHtml,
        price,
        sku,
        product_type: productType,
        inventory_item_id: +s_gql_inventory_item_id.replace("gid://shopify/InventoryItem/", "") || null,
        inventory_CPT,
        inventory_JHB,
        inventory_quantity: inventoryQuantity,
        inventory_policy,
        option1: selectedOptions[0]?.value || null,
        option2: selectedOptions[1]?.value || null,
        option3: selectedOptions[2]?.value || null,
        image_id: +image?.id.replace("gid://shopify/ProductImage/", "") || null,
        s_status: status.toLowerCase(),
        s_needs_variant_image,
        s_has_jhb_inventory,
      });

      return acc;
    }, []);
  }
});

type requestConfig = { api: string, method: "GET" | "POST" | "PUT" | "DELETE", body?: any } | undefined;
type gqlConfig = { body: string } | undefined;

type getDifferenceReturn = {
  vendProducts: requestConfig[]
  shopifyProduct: requestConfig[]
  shopifyVariants: requestConfig[]
  shopifyNewVariants: gqlConfig[]
  shopifyConnectInventory: requestConfig[]
  shopifyDisconnectInventory: requestConfig[]
};

type finalReturn = getDifferenceReturn & { shopifyDeleteVariants: requestConfig[] };

export const getDifferences = (source: productModel[], shopify: productModel[]): finalReturn => {
  const shopifyDeleteVariants = shopify.reduce((acc, targetVariant): requestConfig[] => {
    if (!source.some(({ variant_id }) => variant_id === targetVariant.variant_id)) {
      acc.push({
        api: `/products/${targetVariant.product_id}/variants/${targetVariant.variant_id}.json`,
        method: "DELETE",
      });
    }
    return acc;
  }, []);

  const needs_new_variant_image = source.some((s) => !shopify.some((t) => s.variant_id === t.variant_id));

  return {
    shopifyDeleteVariants,
    ...source.reduce((acc, vend): getDifferenceReturn => {
      /** OPTION Deal with Vend only things
       * Found variant via id */
      const reason = [];
      let vendProductUpdate = false;

      if (vend.v_inconsistent_description) {
        vendProductUpdate = true;
        reason.push("inconsistent description on Vend");
      }

      if (vend.v_inconsistent_tags) {
        vendProductUpdate = true;
        reason.push("inconsistent tags on Vend");
      }

      if (vend.v_incorrectly_unpublished) {
        vendProductUpdate = true;
        reason.push("inconsistent unpublished on Vend");
      }

      /** OPTION 2
       * Found variant via id */
      if (shopify.some(({ variant_id }) => variant_id === vend.variant_id)) {
        const targetVariant = shopify.find(({ variant_id }) => variant_id === vend.variant_id);
        const override = { ...targetVariant, ...vend };
        let shopifyProductUpdate = false;
        let shopifyVariantUpdate = false;
        let shopifyInventoryLevelConnect = false;
        let shopifyInventoryLevelDisconnect = false;

        if (override.v_has_needs_variant_image_tag && !override.s_needs_variant_image && !needs_new_variant_image) {
          override.tags = removeTag(override.tags, "FX_needs_variant_image");
          vendProductUpdate = true;
          shopifyProductUpdate = true;
          reason.push("remove FX_needs_variant_image");
        }

        if (!override.v_has_needs_variant_image_tag && (override.s_needs_variant_image || needs_new_variant_image)) {
          override.tags = addTag(override.tags, "FX_needs_variant_image");
          vendProductUpdate = true;
          shopifyProductUpdate = true;
          reason.push("add FX_needs_variant_image");
        }

        if (override.s_has_jhb_inventory && !override.v_has_sell_jhb_tag) {
          shopifyInventoryLevelDisconnect = true;
          reason.push("Disconnect inventory");
        }

        if (!override.s_has_jhb_inventory && override.v_has_sell_jhb_tag) {
          shopifyInventoryLevelConnect = true;
          reason.push("connect inventory");
        }

        if (vend.sku !== targetVariant.sku) {
          vendProductUpdate = true;
          shopifyVariantUpdate = true;
          reason.push("sku");
        }

        if (vend.price !== targetVariant.price) {
          vendProductUpdate = true;
          shopifyVariantUpdate = true;
          reason.push("price");
        }

        if (!isSameTags(vend.tags, targetVariant.tags)) {
          vendProductUpdate = true;
          shopifyProductUpdate = true;
          reason.push("tags");
        }

        if (!isSameDescription(vend.description, targetVariant.description)) {
          shopifyProductUpdate = true;
          reason.push("description");
        }

        if (vend.product_type !== targetVariant.product_type
          && vend.product_type !== "General"
          && targetVariant.product_type !== "General") {
          vendProductUpdate = true;
          shopifyProductUpdate = true;
          reason.push(`product_type - ${vend.product_type} !== ${targetVariant.product_type}`);
        }

        process.env.NODE_ENV === "development" && reason.length > 0 && console.log(reason);

        if (vendProductUpdate) {
          acc.vendProducts.push({
            api: `/products`,
            method: `POST`,
            body: {
              id: override.vend_id,
              source_id: override.source_id,
              source_variant_id: override.variant_id,
              description: override.description,
              tags: override.tags,
              source: "SHOPIFY",
            },
          });
        }

        if (shopifyProductUpdate && acc.shopifyProduct.length === 0) {
          acc.shopifyProduct.push({
            api: `/products/${override.product_id}.json`,
            method: "PUT",
            body: {
              product: {
                id: override.product_id,
                tags: override.tags,
                body_html: override.description,
                product_type: override.product_type,
              },
            },
          });
        }

        if (shopifyVariantUpdate) {
          acc.shopifyVariants.push({
            api: `/variants/${override.variant_id}.json`,
            method: "PUT",
            body: {
              variant: {
                id: override.variant_id,
                sku: override.sku,
                price: override.price,
                option1: override.option1,
                option2: override.option2,
                option3: override.option3,
              },
            },
          });
        }

        if (shopifyInventoryLevelDisconnect) {
          acc.shopifyDisconnectInventory.push({
            api: `/inventory_levels.json?inventory_item_id=${override.inventory_item_id}&location_id=${SHOPIFY_JHB_OUTLET_ID}`,
            method: "DELETE",
          });
        }
      } else {
        /** OPTION 2
         * NO Variant found */

        if (vendProductUpdate) {
          acc.vendProducts.push({
            api: `/products`,
            method: `POST`,
            body: {
              id: vend.vend_id,
              source_id: vend.source_id,
              source_variant_id: vend.variant_id,
              description: vend.description,
              tags: vend.tags,
              source: "SHOPIFY",
            },
          });
        }

        acc.shopifyNewVariants.push({
          body: createGqlNewProductMutation(vend.product_id,
            vend.sku,
            vend.price,
            vend.inventory_CPT,
            vend.v_has_sell_jhb_tag ? vend.inventory_JHB : undefined,
            vend.option1,
            vend.option2,
            vend.option3),
        });
      }
      return acc;
    }, {
      vendProducts: [],
      shopifyProduct: [],
      shopifyVariants: [],
      shopifyNewVariants: [],
      shopifyConnectInventory: [],
      shopifyDisconnectInventory: [],
    }),
  };
};
