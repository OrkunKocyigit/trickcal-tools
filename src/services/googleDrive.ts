/**
 * Google Drive API 服務層
 * 負責與 Google Drive API 互動
 * 使用新版 Google Identity Services (GIS)
 */

import { GOOGLE_CONFIG, BACKUP_FILENAME } from '@/config/google'
import { logger } from '@/utils/logger'

// 宣告全域變數
declare const google: any
declare const gapi: any

export interface BackupData {
  version: string
  lastSync: string
  board: any
  sweep: any
  roster: any
  metadata: {
    device: string
    appVersion: string
    timestamp: number
  }
}

class GoogleDriveService {
  private isInitialized = false
  private isSignedIn = false
  private accessToken: string | null = null
  private tokenClient: any = null
  private currentUser: any = null
  private tokenExpiryTime: number = 0

  /**
   * 初始化 Google API Client
   */
  async init(): Promise<void> {
    if (this.isInitialized) return

    try {
      // 等待 gapi 載入
      await this.loadGapi()

      // 初始化 gapi.client
      await new Promise<void>((resolve, reject) => {
        gapi.load('client', async () => {
          try {
            await gapi.client.init({
              discoveryDocs: GOOGLE_CONFIG.DISCOVERY_DOCS,
            })
            resolve()
          } catch (error) {
            reject(error)
          }
        })
      })

      // 等待 Google Identity Services 載入
      await this.loadGIS()

      // 初始化 Token Client (新版 OAuth)
      this.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CONFIG.CLIENT_ID,
        scope: GOOGLE_CONFIG.SCOPES,
        callback: (response: any) => {
          // GIS 可能在背景自動刷新 token；此 callback 必須保存
          if (response.error) {
            if (response.error !== 'id_token_expired') {
              logger.error('Token 錯誤:', response)
            }
            // 只有在原本有 token 卻失敗時才清除（非首次載入）
            if (this.accessToken) {
              this.clearAuthState()
            }
            return
          }

          if (response.access_token) {
            // 背景刷新也需驗證 scope；若缺少關鍵 scope 則清除登入
            if (!this.tokenHasDriveScope(response)) {
              logger.warn('背景刷新的 token 缺少 drive.appdata scope，清除登入')
              this.clearAuthState()
              return
            }

            this.accessToken = response.access_token
            this.tokenExpiryTime = Date.now() + (response.expires_in || 3600) * 1000
            gapi.client.setToken({ access_token: this.accessToken })
            this.saveAuthState()
            logger.info('Token 已更新（背景刷新）')
          }
        },
      })

      this.isInitialized = true
      
      // 恢復登入狀態
      await this.loadAuthState()
      
      logger.info('Google Drive API 初始化成功')
    } catch (error) {
      logger.error('Google Drive API 初始化失敗:', error)
      throw error
    }
  }

  /**
   * 等待 gapi 載入
   */
  private loadGapi(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof gapi !== 'undefined') {
        resolve()
        return
      }

      const checkGapi = setInterval(() => {
        if (typeof gapi !== 'undefined') {
          clearInterval(checkGapi)
          resolve()
        }
      }, 100)

      setTimeout(() => {
        clearInterval(checkGapi)
        reject(new Error('gapi 載入逾時'))
      }, 10000)
    })
  }

  /**
   * 等待 Google Identity Services 載入
   */
  private loadGIS(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof google !== 'undefined' && google.accounts) {
        resolve()
        return
      }

      const checkGoogle = setInterval(() => {
        if (typeof google !== 'undefined' && google.accounts) {
          clearInterval(checkGoogle)
          resolve()
        }
      }, 100)

      setTimeout(() => {
        clearInterval(checkGoogle)
        reject(new Error('Google Identity Services 載入逾時'))
      }, 10000)
    })
  }

  /**
   * 檢查 token response 是否包含 drive.appdata scope
   */
  private tokenHasDriveScope(response: any): boolean {
    if (!response || !response.scope) {
      logger.warn('Token response 缺少 scope 欄位，無法驗證')
      return true
    }
    const scopes = response.scope.split(' ')
    const missing = GOOGLE_CONFIG.REQUIRED_SCOPES.filter((s: string) => !scopes.includes(s))
    if (missing.length > 0) {
      logger.warn(`Token 缺少必要 scope: ${missing.join(', ')}`)
    }
    return missing.length === 0
  }

  /**
   * 偵測 gapi 錯誤是否為 accessNotConfigured（API 未啟用）
   */
  private isAccessNotConfiguredError(error: any): boolean {
    if (!error) return false

    // gapi 錯誤格式：result.error.errors[]
    const errObj = error.result?.error || error.error || error
    const errors = errObj.errors || []
    if (errors.some((e: any) => e.reason === 'accessNotConfigured')) {
      return true
    }

    // 也可能在訊息中
    const msg = errObj.message || error.message || ''
    return msg.includes('accessNotConfigured') || msg.includes('Drive API has not been used')
  }

  /**
   * 清除登入狀態
   */
  private clearAuthState() {
    this.accessToken = null
    this.isSignedIn = false
    this.tokenExpiryTime = 0
    this.currentUser = null
    this.saveAuthState()
    localStorage.removeItem('sync_status')
    gapi.client.setToken(null)
  }

  /**
   * 登入 Google
   */
  async signIn(): Promise<void> {
    if (!this.isInitialized) {
      await this.init()
    }

    return new Promise((resolve, reject) => {
      try {
        // 更新 callback 來處理 Promise
        const originalCallback = this.tokenClient.callback
        this.tokenClient.callback = async (response: any) => {
          // 恢復原始 callback 要放在最前面，確保 GIS 下次可用
          this.tokenClient.callback = originalCallback

          if (response.error) {
            logger.error('Google 登入失敗:', response)
            reject(new Error(response.error))
            return
          }

          // 驗證 scope 包含 drive.appdata
          if (!this.tokenHasDriveScope(response)) {
            reject(new Error(
              '缺少 Google Drive 權限。授權時請允許「查看應用程式資料夾」，'
              + '或在 Google 帳戶設定中確認已授予 drive.appdata 權限。'
            ))
            return
          }

          this.accessToken = response.access_token
          this.isSignedIn = true
          this.tokenExpiryTime = Date.now() + (response.expires_in || 3600) * 1000
          gapi.client.setToken({ access_token: this.accessToken })
          
          // 等待獲取用戶信息完成
          await this.fetchUserInfo()
          
          // 保存登入狀態
          this.saveAuthState()
          
          logger.info('Google 登入成功')
          resolve()
        }

        // 請求存取權杖
        this.tokenClient.requestAccessToken({ prompt: 'consent' })
      } catch (error) {
        logger.error('Google 登入失敗:', error)
        reject(error)
      }
    })
  }

  /**
   * 登出 Google
   */
  async signOut(): Promise<void> {
    if (!this.isInitialized) return

    try {
      if (this.accessToken) {
        google.accounts.oauth2.revoke(this.accessToken, () => {
          logger.info('Access token 已撤銷')
        })
      }
      
      this.clearAuthState()
      logger.info('Google 登出成功')
    } catch (error) {
      logger.error('Google 登出失敗:', error)
      throw error
    }
  }

  /**
   * 檢查是否已登入
   */
  checkSignedIn(): boolean {
    return this.isSignedIn && this.accessToken !== null
  }

  /**
   * 獲取當前用戶信息
   */
  getCurrentUser() {
    if (!this.isSignedIn) return null
    return this.currentUser
  }

  /**
   * 獲取用戶資訊（使用 Google OAuth2 userinfo API）
   */
  private async fetchUserInfo() {
    if (!this.accessToken) return

    try {
      const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      })

      if (response.ok) {
        const userInfo = await response.json()
        this.currentUser = {
          id: userInfo.id,
          name: userInfo.name,
          email: userInfo.email,
          imageUrl: userInfo.picture,
        }
        this.saveAuthState()
        logger.info('獲取用戶資訊成功')
      }
    } catch (error) {
      logger.error('獲取用戶資訊失敗:', error)
    }
  }

  /**
   * 保存登入狀態到 localStorage
   */
  private saveAuthState() {
    try {
      const state = {
        isSignedIn: this.isSignedIn,
        accessToken: this.accessToken,
        tokenExpiryTime: this.tokenExpiryTime,
        currentUser: this.currentUser,
      }
      localStorage.setItem('google_auth_state', JSON.stringify(state))
    } catch (error) {
      logger.error('保存登入狀態失敗:', error)
    }
  }

  /**
   * 從 localStorage 恢復登入狀態
   */
  private async loadAuthState() {
    try {
      const savedState = localStorage.getItem('google_auth_state')
      if (!savedState) return

      const state = JSON.parse(savedState)
      
      // 檢查 token 是否過期
      if (state.tokenExpiryTime && Date.now() < state.tokenExpiryTime) {
        this.isSignedIn = state.isSignedIn
        this.accessToken = state.accessToken
        this.tokenExpiryTime = state.tokenExpiryTime
        this.currentUser = state.currentUser
        
        if (this.accessToken) {
          gapi.client.setToken({ access_token: this.accessToken })
          logger.info('恢復登入狀態成功，用戶信息:', this.currentUser)
          
          // 如果沒有用戶信息，嘗試重新獲取
          if (!this.currentUser || !this.currentUser.imageUrl) {
            logger.info('用戶信息不完整，重新獲取...')
            await this.fetchUserInfo()
          }
        }
      } else {
        // Token 已過期，清除狀態
        localStorage.removeItem('google_auth_state')
        logger.info('Token 已過期')
      }
    } catch (error) {
      logger.error('恢復登入狀態失敗:', error)
    }
  }

  /**
   * 確保 token 有效，過期則嘗試靜默刷新
   */
  private async ensureValidToken(): Promise<void> {
    if (this.tokenExpiryTime && Date.now() < this.tokenExpiryTime) {
      return
    }

    // Token 過期或即將過期，嘗試靜默刷新但驗證 scope
    return new Promise((resolve, reject) => {
      const originalCallback = this.tokenClient.callback
      this.tokenClient.callback = (response: any) => {
        this.tokenClient.callback = originalCallback
        if (response.error) {
          this.clearAuthState()
          reject(new Error('登入狀態已過期，請重新登入'))
          return
        }

        // 驗證刷新後的 token 仍包含 drive.appdata
        if (!this.tokenHasDriveScope(response)) {
          this.clearAuthState()
          reject(new Error('權限不足：缺少 Google Drive 存取權限。請重新登入並允許所有必要權限。'))
          return
        }

        this.accessToken = response.access_token
        this.tokenExpiryTime = Date.now() + (response.expires_in || 3600) * 1000
        gapi.client.setToken({ access_token: this.accessToken })
        this.saveAuthState()
        resolve()
      }
      this.tokenClient.requestAccessToken({ prompt: '' })
    })
  }

  /**
   * 確保已登入且 token 有效
   */
  private async requireValidAuth(): Promise<void> {
    if (!this.isSignedIn) {
      throw new Error('請先登入 Google')
    }
    await this.ensureValidToken()
  }

  /**
   * 拋出「Google Drive API 未啟用」錯誤
   */
  private throwAccessNotConfiguredError(): never {
    throw new Error(
      'Google Drive API 尚未啟用。請前往 Google Cloud Console '
      + '→ 資料庫 → Google Drive API → 啟用，然後重試。'
    )
  }

  /**
   * 搜尋備份檔案
   */
  async findBackupFile(): Promise<any> {
    await this.requireValidAuth()

    try {
      const response = await gapi.client.drive.files.list({
        spaces: 'appDataFolder',
        fields: 'files(id, name, modifiedTime, size)',
        q: `name='${BACKUP_FILENAME}'`,
      })

      const files = response.result.files || []
      return files.length > 0 ? files[0] : null
    } catch (error) {
      logger.error('搜尋備份檔案失敗:', error)
      if (this.isAccessNotConfiguredError(error)) {
        this.throwAccessNotConfiguredError()
      }
      throw error
    }
  }

  /**
   * 下載備份檔案
   */
  async downloadBackup(fileId: string): Promise<BackupData> {
    await this.requireValidAuth()

    try {
      const response = await gapi.client.drive.files.get({
        fileId: fileId,
        alt: 'media',
      })

      logger.info('從 Google Drive 下載備份成功')
      return response.result as any as BackupData
    } catch (error) {
      logger.error('下載備份檔案失敗:', error)
      if (this.isAccessNotConfiguredError(error)) {
        this.throwAccessNotConfiguredError()
      }
      throw error
    }
  }

  /**
   * 上傳備份檔案
   */
  async uploadBackup(data: BackupData, existingFileId?: string): Promise<string> {
    await this.requireValidAuth()

    try {
      const boundary = '-------314159265358979323846'
      const delimiter = `\r\n--${boundary}\r\n`
      const closeDelimiter = `\r\n--${boundary}--`

      // 更新檔案時不能包含 parents 欄位
      const metadata = existingFileId
        ? {
            name: BACKUP_FILENAME,
            mimeType: 'application/json',
          }
        : {
            name: BACKUP_FILENAME,
            mimeType: 'application/json',
            parents: ['appDataFolder'],
          }

      const multipartRequestBody =
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: application/json\r\n\r\n' +
        JSON.stringify(data, null, 2) +
        closeDelimiter

      const request = existingFileId
        ? gapi.client.request({
            path: `/upload/drive/v3/files/${existingFileId}`,
            method: 'PATCH',
            params: { uploadType: 'multipart' },
            headers: {
              'Content-Type': `multipart/related; boundary="${boundary}"`,
            },
            body: multipartRequestBody,
          })
        : gapi.client.request({
            path: '/upload/drive/v3/files',
            method: 'POST',
            params: { uploadType: 'multipart' },
            headers: {
              'Content-Type': `multipart/related; boundary="${boundary}"`,
            },
            body: multipartRequestBody,
          })

      const response = await request
      logger.info('上傳備份到 Google Drive 成功')
      return response.result.id
    } catch (error) {
      logger.error('上傳備份檔案失敗:', error)
      if (this.isAccessNotConfiguredError(error)) {
        this.throwAccessNotConfiguredError()
      }
      throw error
    }
  }

  /**
   * 刪除備份檔案
   */
  async deleteBackup(fileId: string): Promise<void> {
    await this.requireValidAuth()

    try {
      await gapi.client.drive.files.delete({
        fileId: fileId,
      })
      logger.info('刪除 Google Drive 備份成功')
    } catch (error) {
      logger.error('刪除備份檔案失敗:', error)
      if (this.isAccessNotConfiguredError(error)) {
        this.throwAccessNotConfiguredError()
      }
      throw error
    }
  }
}

// 導出單例
export const googleDrive = new GoogleDriveService()

