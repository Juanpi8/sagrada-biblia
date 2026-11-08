package uy.juanpi.sagradabiblia

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.k2fsa.sherpa.onnx.GeneratedAudio
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.Future

/**
 * On-device neural voices (Piper/VITS through sherpa-onnx), running natively on all CPU cores.
 * JS: prepare(key,text,speed) synthesizes in the background; play(key) plays it and resolves when it ends.
 */
@CapacitorPlugin(name = "PiperNative")
class PiperNativePlugin : Plugin() {
    private val genExec = Executors.newSingleThreadExecutor()
    private val playExec = Executors.newSingleThreadExecutor()
    private val ioExec = Executors.newSingleThreadExecutor()
    private val cache = ConcurrentHashMap<String, Future<GeneratedAudio>>()
    @Volatile private var tts: OfflineTts? = null
    @Volatile private var loadedId: String? = null
    @Volatile private var track: AudioTrack? = null
    @Volatile private var generation = 0

    private data class ModelFiles(val model: String, val tokens: String, val dataDir: String)

    private fun voiceDir(id: String) = File(context.filesDir, "voices/$id")

    private fun findModel(dir: File): ModelFiles? {
        if (!dir.exists()) return null
        var model: File? = null; var tokens: File? = null; var data: File? = null
        dir.walkTopDown().maxDepth(3).forEach { f ->
            if (f.isFile && f.name.endsWith(".onnx") && model == null) model = f
            if (f.isFile && f.name == "tokens.txt" && tokens == null) tokens = f
            if (f.isDirectory && f.name == "espeak-ng-data" && data == null) data = f
        }
        val m = model ?: return null; val t = tokens ?: return null; val d = data ?: return null
        return ModelFiles(m.absolutePath, t.absolutePath, d.absolutePath)
    }

    @PluginMethod
    fun isDownloaded(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id")
        call.resolve(JSObject().put("value", findModel(voiceDir(id)) != null))
    }

    @PluginMethod
    fun download(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id")
        val url = call.getString("url") ?: return call.reject("url")
        call.setKeepAlive(false)
        ioExec.execute {
            val tmp = File(context.cacheDir, "$id.tar.bz2")
            try {
                var u = URL(url); var conn: HttpURLConnection
                var hops = 0
                while (true) {
                    conn = u.openConnection() as HttpURLConnection
                    conn.instanceFollowRedirects = false
                    conn.connectTimeout = 20000; conn.readTimeout = 60000
                    val code = conn.responseCode
                    if (code in 300..399 && hops < 8) { u = URL(u, conn.getHeaderField("Location")); conn.disconnect(); hops++; continue }
                    if (code != 200) throw Exception("HTTP $code")
                    break
                }
                val total = conn.contentLengthLong
                var got = 0L; var lastPct = -1
                conn.inputStream.use { input ->
                    FileOutputStream(tmp).use { out ->
                        val buf = ByteArray(1 shl 16)
                        while (true) {
                            val n = input.read(buf); if (n < 0) break
                            out.write(buf, 0, n); got += n
                            if (total > 0) {
                                val pct = (got * 90 / total).toInt()
                                if (pct != lastPct) { lastPct = pct; notifyListeners("progress", JSObject().put("id", id).put("p", pct)) }
                            }
                        }
                    }
                }
                val dir = voiceDir(id); dir.deleteRecursively(); dir.mkdirs()
                TarArchiveInputStream(BZip2CompressorInputStream(BufferedInputStream(FileInputStream(tmp)))).use { tar ->
                    var e = tar.nextEntry
                    while (e != null) {
                        val parts = e.name.split('/').filter { it.isNotEmpty() }
                        val rel = if (parts.size > 1) parts.drop(1).joinToString("/") else parts.joinToString("/")
                        if (rel.isNotEmpty() && !rel.contains("..")) {
                            val f = File(dir, rel)
                            if (e.isDirectory) f.mkdirs() else { f.parentFile?.mkdirs(); FileOutputStream(f).use { tar.copyTo(it) } }
                        }
                        e = tar.nextEntry
                    }
                }
                tmp.delete()
                notifyListeners("progress", JSObject().put("id", id).put("p", 100))
                if (findModel(dir) == null) throw Exception("incomplete model")
                call.resolve()
            } catch (ex: Exception) {
                tmp.delete(); voiceDir(id).deleteRecursively()
                call.reject(ex.toString())
            }
        }
    }

    @PluginMethod
    fun remove(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id")
        if (loadedId == id) { tts = null; loadedId = null }
        voiceDir(id).deleteRecursively(); call.resolve()
    }

    @PluginMethod
    fun load(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id")
        genExec.execute {
            try {
                if (loadedId != id || tts == null) {
                    val f = findModel(voiceDir(id)) ?: throw Exception("not downloaded")
                    val threads = Runtime.getRuntime().availableProcessors().coerceIn(2, 4)
                    val cfg = OfflineTtsConfig(
                        model = OfflineTtsModelConfig(
                            vits = OfflineTtsVitsModelConfig(model = f.model, tokens = f.tokens, dataDir = f.dataDir),
                            numThreads = threads, debug = false, provider = "cpu"
                        ),
                        maxNumSentences = 1
                    )
                    tts = OfflineTts(config = cfg); loadedId = id
                }
                call.resolve()
            } catch (ex: Throwable) { call.reject(ex.toString()) }
        }
    }

    @PluginMethod
    fun prepare(call: PluginCall) {
        val key = call.getString("key") ?: return call.reject("key")
        val text = call.getString("text") ?: ""
        val speed = (call.getFloat("speed") ?: 1.0f)
        if (!cache.containsKey(key)) {
            cache[key] = genExec.submit<GeneratedAudio> {
                val engine = tts ?: throw IllegalStateException("not loaded")
                engine.generate(text, 0, speed)
            }
        }
        call.resolve()
    }

    @PluginMethod
    fun play(call: PluginCall) {
        val key = call.getString("key") ?: return call.reject("key")
        val myGen = generation
        playExec.execute {
            try {
                val audio = (cache[key] ?: throw IllegalStateException("not prepared")).get()
                cache.remove(key)
                if (myGen != generation) { call.resolve(); return@execute }
                val samples = audio.samples; val sr = audio.sampleRate
                if (sr <= 0 || samples.isEmpty()) { call.resolve(); return@execute }
                val minBuf = AudioTrack.getMinBufferSize(sr, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_FLOAT)
                // Float mono = 4 bytes per frame: the buffer must be a positive multiple of 4 (≈0.5 s here).
                val bufBytes = ((maxOf(minBuf, sr * 2) + 3) / 4) * 4
                val t = AudioTrack.Builder()
                    .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                    .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_FLOAT).setSampleRate(sr).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                    .setTransferMode(AudioTrack.MODE_STREAM)
                    .setBufferSizeInBytes(bufBytes)
                    .build()
                track = t
                t.play()
                var off = 0; val chunk = sr / 4
                while (off < samples.size && myGen == generation) {
                    val n = minOf(chunk, samples.size - off)
                    val w = t.write(samples, off, n, AudioTrack.WRITE_BLOCKING)
                    if (w <= 0) break
                    off += w
                }
                while (myGen == generation && t.playState == AudioTrack.PLAYSTATE_PLAYING && t.playbackHeadPosition < off) Thread.sleep(15)
                try { t.stop() } catch (_: Exception) {}
                t.release(); if (track === t) track = null
                call.resolve()
            } catch (ex: Throwable) { call.reject(ex.toString()) }
        }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        generation++
        cache.values.forEach { it.cancel(false) }
        cache.clear()
        track?.let { try { it.pause(); it.flush() } catch (_: Exception) {} }
        call.resolve()
    }
}
