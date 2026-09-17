package com.batyeo.runtime

import android.content.Context
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.VideoView
import java.io.File
import java.net.URL
import java.util.concurrent.Executors

/**
 * Idle advertising surface: plays the station's published playlist on a loop.
 *
 * Images advance on their configured duration; videos advance when playback
 * actually completes, so a clip is never cut off by a duration that disagrees
 * with the file. Media is cached on disk keyed by URL, which is what lets the
 * carousel keep playing through a network outage.
 */
class MediaCarouselView(context: Context) : FrameLayout(context) {

    private val imageView = ImageView(context).apply {
        scaleType = ImageView.ScaleType.CENTER_CROP
        layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    }
    private val videoView = VideoView(context).apply {
        layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT, android.view.Gravity.CENTER)
    }
    private val handler = Handler(Looper.getMainLooper())
    private val downloads = Executors.newSingleThreadExecutor()
    private val advance = Runnable { showNext() }
    private var playlist: List<MediaItem> = emptyList()
    private var index = 0
    private var running = false

    init {
        addView(imageView)
        addView(videoView)
        videoView.visibility = View.GONE
        videoView.setOnCompletionListener { showNext() }
        videoView.setOnErrorListener { _, what, _ ->
            Log.w(TAG, "Video playback failed ($what), skipping to next item")
            showNext()
            true
        }
    }

    fun setPlaylist(items: List<MediaItem>) {
        val changed = items.map { it.id } != playlist.map { it.id }
        playlist = items
        items.forEach { cacheInBackground(it) }
        if (changed) {
            index = 0
            if (running) start()
        }
    }

    fun start() {
        running = true
        handler.removeCallbacks(advance)
        if (playlist.isEmpty()) return
        show(playlist[index % playlist.size])
    }

    fun stop() {
        running = false
        handler.removeCallbacks(advance)
        if (videoView.isPlaying) videoView.stopPlayback()
    }

    private fun showNext() {
        if (!running || playlist.isEmpty()) return
        index = (index + 1) % playlist.size
        show(playlist[index])
    }

    private fun show(item: MediaItem) {
        handler.removeCallbacks(advance)
        val local = cachedFile(item)
        if (item.isVideo) {
            imageView.visibility = View.GONE
            videoView.visibility = View.VISIBLE
            videoView.setVideoURI(if (local.exists()) Uri.fromFile(local) else Uri.parse(item.uri))
            videoView.start()
            // Safety net: if the player never reports completion, move on anyway.
            handler.postDelayed(advance, item.durationMs.coerceAtLeast(MIN_DURATION_MS) + VIDEO_GRACE_MS)
        } else {
            videoView.visibility = View.GONE
            imageView.visibility = View.VISIBLE
            if (local.exists()) {
                runCatching { imageView.setImageBitmap(BitmapFactory.decodeFile(local.absolutePath)) }
                    .onFailure { Log.w(TAG, "Unreadable cached image ${item.id}", it) }
            }
            handler.postDelayed(advance, item.durationMs.coerceAtLeast(MIN_DURATION_MS))
        }
    }

    private fun cachedFile(item: MediaItem) = File(context.cacheDir, "media-${item.id}")

    private fun cacheInBackground(item: MediaItem) {
        val target = cachedFile(item)
        if (target.exists()) return
        downloads.execute {
            runCatching {
                val temporary = File(target.parentFile, target.name + ".tmp")
                URL(item.uri).openStream().use { input -> temporary.outputStream().use { input.copyTo(it) } }
                temporary.renameTo(target)
                handler.post { if (running && playlist.getOrNull(index)?.id == item.id) show(item) }
            }.onFailure { Log.w(TAG, "Could not cache media ${item.id}", it) }
        }
    }

    private companion object {
        const val TAG = "BatyeoCarousel"
        const val MIN_DURATION_MS = 1_000L
        const val VIDEO_GRACE_MS = 2_000L
    }
}
