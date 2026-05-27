import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router'
import i18n from '@/i18n'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Home',
    component: () => import('@/views/Home.vue'),
    meta: { titleKey: 'nav.home' }
  },
  {
    path: '/board',
    name: 'Board',
    component: () => import('@/views/Board.vue'),
    meta: { titleKey: 'nav.board' }
  },
  {
    path: '/sweep',
    name: 'Sweep',
    component: () => import('@/views/Sweep.vue'),
    meta: { titleKey: 'nav.sweep' }
  },
  {
    path: '/food',
    name: 'Food',
    component: () => import('@/views/Food.vue'),
    meta: { titleKey: 'nav.food' }
  },
  {
    path: '/armory',
    name: 'Armory',
    component: () => import('@/views/Armory.vue'),
    meta: { titleKey: 'nav.armory' }
  },
  {
    path: '/changelog',
    name: 'Changelog',
    component: () => import('@/views/Changelog.vue'),
    meta: { titleKey: 'changelog.title' }
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
  if (to.meta.titleKey) {
    document.title = i18n.global.t(to.meta.titleKey as string)
  }
})

export default router

