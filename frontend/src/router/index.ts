import { createRouter, createWebHistory } from "vue-router";
export const router = createRouter({
  history:createWebHistory(import.meta.env.BASE_URL),
  routes:[
    {path:"/",redirect:{name:"overview",hash:""}},
    {path:"/overview",name:"overview",component:()=>import("../components/OverviewPage.vue"),meta:{title:"总览"}},
    {path:"/sessions/:sessionId?",name:"sessions",component:()=>import("../components/ConversationsPage.vue"),meta:{title:"会话"}},
    {path:"/knowledge",name:"knowledge",component:()=>import("../components/KnowledgePage.vue"),meta:{title:"知识库"}},
    {path:"/calls",name:"calls",component:()=>import("../components/CallsPage.vue"),meta:{title:"调用记录"}},
    {path:"/:pathMatch(.*)*",redirect:{name:"overview",hash:""}}
  ],
  scrollBehavior:()=>({top:0})
});
router.afterEach(to=>{ document.title=`${String(to.meta.title || "总览")} · AI 对话工作台`; });
