import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Home',
    component: () => import('@/views/Home.vue'),
    meta: { title: 'Trickcal 工具集' }
  },
  {
    path: '/board',
    name: 'Board',
    component: () => import('@/views/Board.vue'),
    meta: { title: '金蠟筆記錄本' }
  },
  {
    path: '/sweep',
    name: 'Sweep',
    component: () => import('@/views/Sweep.vue'),
    meta: { title: '掃蕩工具' }
  },
  {
    path: '/food',
    name: 'Food',
    component: () => import('@/views/Food.vue'),
    meta: { title: '食物喜好' }
  },
  {
    path: '/armory',
    name: 'Armory',
    component: () => import('@/views/Armory.vue'),
    meta: { title: '裝備工坊' }
  },
  {
    path: '/changelog',
    name: 'Changelog',
    component: () => import('@/views/Changelog.vue'),
    meta: { title: '開發日誌' }
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/'
  }
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior() {
    return { top: 0 }
  }
})

router.beforeEach((to) => {
  if (to.meta.title) {
    document.title = to.meta.title as string
  }
})

export default router

