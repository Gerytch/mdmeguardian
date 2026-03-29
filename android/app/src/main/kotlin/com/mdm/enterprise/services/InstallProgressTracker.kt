package com.mdm.enterprise.services

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

object InstallProgressTracker {

    enum class Status { QUEUED, DOWNLOADING, INSTALLING, DONE, FAILED }

    data class AppProgress(
        val packageName: String,
        val appName: String,
        val status: Status = Status.QUEUED,
        val downloadProgress: Int = 0,   // 0-100, only meaningful during DOWNLOADING
        val errorMessage: String? = null,
    )

    private val _items = MutableStateFlow<List<AppProgress>>(emptyList())
    val items: StateFlow<List<AppProgress>> = _items.asStateFlow()

    fun startSession(apps: List<Pair<String, String>>) {
        _items.value = apps.map { (pkg, name) -> AppProgress(pkg, name) }
    }

    fun updateDownload(packageName: String, progress: Int) {
        update(packageName) { copy(status = Status.DOWNLOADING, downloadProgress = progress) }
    }

    fun startInstall(packageName: String) {
        update(packageName) { copy(status = Status.INSTALLING, downloadProgress = 100) }
    }

    fun markDone(packageName: String) {
        update(packageName) { copy(status = Status.DONE) }
        maybeAutoClose()
    }

    fun markFailed(packageName: String, reason: String? = null) {
        update(packageName) { copy(status = Status.FAILED, errorMessage = reason) }
        maybeAutoClose()
    }

    fun markSkipped(packageName: String) {
        update(packageName) { copy(status = Status.DONE) }
        maybeAutoClose()
    }

    fun clear() {
        _items.value = emptyList()
    }

    private fun update(packageName: String, block: AppProgress.() -> AppProgress) {
        _items.value = _items.value.map { if (it.packageName == packageName) it.block() else it }
    }

    private fun maybeAutoClose() {
        val all = _items.value
        if (all.isNotEmpty() && all.all { it.status == Status.DONE || it.status == Status.FAILED }) {
            // Keep visible for 3 seconds then clear
            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({ clear() }, 3_000)
        }
    }
}
