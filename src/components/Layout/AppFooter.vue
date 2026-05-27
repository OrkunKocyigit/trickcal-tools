<template>
  <footer class="site-footer">
    <div class="footer-content">
      <div class="footer-info">
        <p class="footer-text">
          <span class="footer-label">{{ $t('footer.author') }}：</span>
          <span class="footer-value">{{ $t('footer.authorValue') }}</span>
        </p>
        <p class="footer-text">
          <span class="footer-label">{{ $t('footer.copyright') }}：</span>
          <span class="footer-value">{{ $t('footer.copyrightValue') }}</span>
        </p>
        <router-link to="/changelog" class="changelog-link">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
            <polyline points="10 9 9 9 8 9"></polyline>
          </svg>
          {{ $t('changelog.title') }}
        </router-link>
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
</script>

<style scoped>
.site-footer {
  margin-top: auto;
  padding: 2rem;
  background: var(--footer-bg);
  border-top: 1px solid var(--border-color);
}

.footer-content {
  max-width: 1400px;
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 2rem;
}

.footer-info {
  display: flex;
  flex-wrap: wrap;
  gap: 2rem;
  align-items: center;
}

.footer-text {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.875rem;
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.footer-label {
  font-weight: 500;
}

.footer-value {
  color: var(--text-primary);
  font-weight: 600;
}

.changelog-link {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 0.875rem;
  font-weight: 500;
  border-radius: 8px;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  transition: all 0.2s;
}

.changelog-link:hover {
  color: var(--primary-color);
  border-color: var(--primary-color);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.changelog-link svg {
  width: 16px;
  height: 16px;
}

@media (max-width: 768px) {
  .site-footer {
    padding: 1.5rem 1rem;
  }

  .footer-content {
    flex-direction: column;
    gap: 1.5rem;
    text-align: center;
  }

  .footer-info {
    flex-direction: column;
    gap: 0.75rem;
  }

  .footer-text {
    font-size: 0.8125rem;
    justify-content: center;
  }
}
</style>

