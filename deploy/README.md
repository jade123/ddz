# 生产部署

目标域名：`http://ddz.lure.red`

服务器沿用现有 `lure.red` 子域名部署方式：Node.js systemd 服务 + Nginx 反代。

```bash
cd /var/www
git clone https://github.com/jade123/ddz.git ddz
cp /var/www/ddz/deploy/ddz.service /etc/systemd/system/ddz.service
cp /var/www/ddz/deploy/nginx-ddz.conf /etc/nginx/conf.d/ddz.conf
systemctl daemon-reload
systemctl enable --now ddz
nginx -t
systemctl reload nginx
```

更新代码：

```bash
cd /var/www/ddz
git pull --ff-only origin main
systemctl restart ddz
```
