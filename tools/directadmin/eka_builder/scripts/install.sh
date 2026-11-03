#!/bin/sh
# DirectAdmin runs this when the plugin is installed.
cd /usr/local/directadmin/plugins/eka_builder || exit 1
chown -R diradmin:diradmin .
chmod 755 user/index.html scripts/*.sh
chmod 700 conf
[ -f conf/config.ini ] || cp conf/config.ini.example conf/config.ini
chmod 600 conf/config.ini
echo "Installed. Now edit /usr/local/directadmin/plugins/eka_builder/conf/config.ini with the builder's address and host API key."
exit 0
