package com.mdm.enterprise.utils

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

object SecurePreferences {

    @Volatile
    private var instance: SharedPreferences? = null

    fun getInstance(context: Context): SharedPreferences {
        return instance ?: synchronized(this) {
            instance ?: create(context).also { instance = it }
        }
    }

    private fun create(context: Context): SharedPreferences {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()

        return EncryptedSharedPreferences.create(
            context,
            "mdm_secure_prefs",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }
}

// Top-level extension helpers — import these at the call site
fun SharedPreferences.getStr(key: String, default: String? = null): String? =
    getString(key, default)

fun SharedPreferences.putStr(key: String, value: String) =
    edit().putString(key, value).apply()

fun SharedPreferences.getBool(key: String, default: Boolean = false): Boolean =
    getBoolean(key, default)

fun SharedPreferences.putBool(key: String, value: Boolean) =
    edit().putBoolean(key, value).apply()
