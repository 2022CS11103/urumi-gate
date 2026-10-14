<?php
/**
 * Plugin Name: Urumi internal REST
 * Description: Lets the in-cluster WooCommerce MCP server use HTTP Basic auth without a public TLS hop.
 */

if (isset($_SERVER["HTTP_X_URUMI_INTERNAL"]) && $_SERVER["HTTP_X_URUMI_INTERNAL"] === "1") {
    $_SERVER["HTTPS"] = "on";
}

add_filter("redirect_canonical", function ($redirect) {
    if (isset($_SERVER["HTTP_X_URUMI_INTERNAL"]) && $_SERVER["HTTP_X_URUMI_INTERNAL"] === "1") {
        return false;
    }
    return $redirect;
});
