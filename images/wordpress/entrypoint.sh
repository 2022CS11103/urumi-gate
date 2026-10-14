#!/bin/bash
set -euo pipefail

if [[ ! -f /etc/apache2/conf-available/urumi-auth.conf ]]; then
  cat > /etc/apache2/conf-available/urumi-auth.conf << 'EOF'
SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1
EOF
  a2enconf urumi-auth >/dev/null 2>&1 || true
fi

/usr/local/bin/docker-entrypoint.sh "$@" &
pid=$!
trap 'kill -TERM $pid 2>/dev/null || true; wait $pid' TERM INT

(
  set +e
  echo "urumi: waiting for WordPress files"
  for _ in $(seq 1 90); do
    if [[ -f /var/www/html/wp-config.php ]]; then
      break
    fi
    sleep 2
  done
  mkdir -p /var/www/html/wp-content/mu-plugins
  cp -f /opt/urumi/mu-plugins/*.php /var/www/html/wp-content/mu-plugins/
  echo "urumi: waiting for MariaDB"
  for _ in $(seq 1 90); do
    if wp db check --allow-root --path=/var/www/html >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done
  if ! wp core is-installed --allow-root --path=/var/www/html >/dev/null 2>&1; then
    wp core install --allow-root --path=/var/www/html \
      --url="${WORDPRESS_URL:?WORDPRESS_URL is required}" \
      --title="${WORDPRESS_TITLE:-Northwind Supply}" \
      --admin_user="${WORDPRESS_ADMIN_USER:-admin}" \
      --admin_password="${WORDPRESS_ADMIN_PASSWORD:?WORDPRESS_ADMIN_PASSWORD is required}" \
      --admin_email="${WORDPRESS_ADMIN_EMAIL:-admin@urumi.local}" \
      --skip-email
  fi
  wp option update home "${WORDPRESS_URL}" --allow-root --path=/var/www/html
  wp option update siteurl "${WORDPRESS_URL}" --allow-root --path=/var/www/html
  if ! wp plugin is-active woocommerce --allow-root --path=/var/www/html >/dev/null 2>&1; then
    wp plugin install /opt/urumi/woocommerce.zip --activate --allow-root --path=/var/www/html
  fi
  wp rewrite structure '/%postname%/' --hard --allow-root --path=/var/www/html
  wp rewrite flush --hard --allow-root --path=/var/www/html
  wp eval-file /opt/urumi/bootstrap.php --allow-root --path=/var/www/html
  status=$?
  if [[ $status -eq 0 ]]; then
    touch /var/www/html/urumi-ready
    echo "urumi: store is ready"
  else
    echo "urumi: bootstrap failed with status ${status}"
  fi
) &

wait "$pid"
