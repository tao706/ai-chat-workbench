import { router } from "./router";
import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./styles.css";
import "./element-theme.css";

const app=createApp(App);
app.use(createPinia());
app.use(router);
void router.isReady().then(()=>app.mount("#app"));
