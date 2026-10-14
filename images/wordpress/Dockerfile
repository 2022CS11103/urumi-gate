FROM wordpress:6.8.3-php8.3-apache

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl less ca-certificates \
 && curl -fsSL -o /usr/local/bin/wp https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar \
 && chmod +x /usr/local/bin/wp \
 && curl -fsSL -o /tmp/woocommerce.zip https://downloads.wordpress.org/plugin/woocommerce.11.2.1.zip \
 && mkdir -p /opt/urumi \
 && mv /tmp/woocommerce.zip /opt/urumi/woocommerce.zip \
 && rm -rf /var/lib/apt/lists/*

COPY mu-plugins /opt/urumi/mu-plugins
COPY bootstrap.php /opt/urumi/bootstrap.php
COPY entrypoint.sh /usr/local/bin/urumi-entrypoint.sh
RUN chmod +x /usr/local/bin/urumi-entrypoint.sh

ENTRYPOINT ["urumi-entrypoint.sh"]
CMD ["apache2-foreground"]
