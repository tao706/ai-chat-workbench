# History 路由部署

页面地址为 /overview、/sessions、/knowledge、/calls。开发环境由 Vite 自动回退到 index.html。

部署静态前端时，需要让找不到静态文件的页面请求回退到 index.html，否则直接访问子页面或刷新会返回 404。例如 Nginx：

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

/api/ 必须单独配置代理到后端，不能回退到前端页面。路由只管理当前页面；会话和调用数据继续通过后台接口加载。
