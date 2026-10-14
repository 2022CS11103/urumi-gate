<?php
/**
 * Idempotent store setup. Run with: wp eval-file bootstrap.php
 */

if (!defined("ABSPATH")) {
    fwrite(STDERR, "bootstrap.php must be run with wp eval-file\n");
    exit(1);
}

require_once ABSPATH . "wp-admin/includes/plugin.php";

if (!is_plugin_active("woocommerce/woocommerce.php")) {
    fwrite(STDERR, "WooCommerce is not active\n");
    exit(1);
}

$key = getenv("WOO_CONSUMER_KEY");
$secret = getenv("WOO_CONSUMER_SECRET");
if (!$key || !$secret) {
    fwrite(STDERR, "WOO_CONSUMER_KEY and WOO_CONSUMER_SECRET are required\n");
    exit(1);
}

update_option("woocommerce_coming_soon", "no");
update_option("woocommerce_store_pages_only", "no");
update_option("woocommerce_onboarding_profile", ["completed" => true]);
update_option("woocommerce_currency", "USD");
update_option("woocommerce_price_num_decimals", "2");
update_option("woocommerce_default_country", "US:CA");
update_option("woocommerce_store_address", "1 Market Street");
update_option("woocommerce_store_city", "San Francisco");
update_option("woocommerce_store_postcode", "94105");
update_option("woocommerce_calc_taxes", "no");
update_option("woocommerce_enable_guest_checkout", "yes");
update_option("woocommerce_enable_checkout_login_reminder", "no");
update_option("woocommerce_cod_settings", [
    "enabled" => "yes",
    "title" => "Cash on delivery",
    "description" => "Pay when the order arrives.",
    "instructions" => "Please pay the courier.",
    "enable_for_methods" => [],
    "enable_for_virtual" => "yes",
]);

if (class_exists("WC_Install")) {
    WC_Install::create_pages();
}

$zone = new WC_Shipping_Zone(0);
$has_free = false;
foreach ($zone->get_shipping_methods() as $method) {
    if ($method->id === "free_shipping") {
        $has_free = true;
    }
}
if (!$has_free) {
    $instance_id = $zone->add_shipping_method("free_shipping");
    update_option("woocommerce_free_shipping_{$instance_id}_settings", [
        "title" => "Free shipping",
        "requires" => "",
        "min_amount" => "0",
        "enabled" => "yes",
    ]);
}

global $wpdb;
$table = $wpdb->prefix . "woocommerce_api_keys";
$admin = get_user_by("login", getenv("WORDPRESS_ADMIN_USER") ?: "admin");
$user_id = $admin ? (int) $admin->ID : 1;
$wpdb->delete($table, ["description" => "Urumi Gate"]);
if (strlen($secret) !== 43) {
    fwrite(STDERR, "WOO_CONSUMER_SECRET must be 43 characters; WooCommerce stores it verbatim in a char(43) column\n");
    exit(1);
}
$wpdb->insert($table, [
    "user_id" => $user_id,
    "description" => "Urumi Gate",
    "permissions" => "read_write",
    "consumer_key" => hash_hmac("sha256", $key, "wc-api"),
    "consumer_secret" => $secret,
    "truncated_key" => substr($key, -7),
]);

$existing = wc_get_products(["limit" => 1, "status" => "publish"]);
if (count($existing) === 0) {
    foreach ([["Linen Apron", "28.00"], ["Cast Iron Pan", "54.00"]] as [$name, $price]) {
        $product = new WC_Product_Simple();
        $product->set_name($name);
        $product->set_regular_price($price);
        $product->set_status("publish");
        $product->set_catalog_visibility("visible");
        $product->set_stock_status("instock");
        $product->save();
    }
}

echo "urumi store bootstrap ok\n";
