package expo.modules.prescriptionmask

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.FileOutputStream

class PrescriptionMaskModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PrescriptionMask")
    AsyncFunction("decodeImageToRgb") { inputPath: String ->
      val source = BitmapFactory.decodeFile(inputPath) ?: throw IllegalArgumentException("Image cannot be decoded")
      val width = source.width
      val height = source.height
      val pixels = IntArray(width * height)
      source.getPixels(pixels, 0, width, 0, 0, width, height)
      val rgb = ByteArray(width * height * 3)
      for (i in pixels.indices) {
        val pixel = pixels[i]
        rgb[i * 3] = ((pixel shr 16) and 0xFF).toByte()
        rgb[i * 3 + 1] = ((pixel shr 8) and 0xFF).toByte()
        rgb[i * 3 + 2] = (pixel and 0xFF).toByte()
      }
      source.recycle()
      mapOf("data" to rgb, "width" to width, "height" to height)
    }
    AsyncFunction("createMaskedCopy") { inputPath: String, outputPath: String, masks: List<Map<String, Double>> ->
      val source = BitmapFactory.decodeFile(inputPath) ?: throw IllegalArgumentException("Image cannot be decoded")
      val output = source.copy(Bitmap.Config.ARGB_8888, true) ?: throw IllegalStateException("Image cannot be copied")
      val canvas = Canvas(output)
      val paint = Paint().apply { color = Color.BLACK; style = Paint.Style.FILL }
      masks.forEach { mask ->
        val left = mask["left"]?.toFloat() ?: throw IllegalArgumentException("Mask left is missing")
        val top = mask["top"]?.toFloat() ?: throw IllegalArgumentException("Mask top is missing")
        val right = mask["right"]?.toFloat() ?: throw IllegalArgumentException("Mask right is missing")
        val bottom = mask["bottom"]?.toFloat() ?: throw IllegalArgumentException("Mask bottom is missing")
        require(left >= 0 && top >= 0 && right <= output.width && bottom <= output.height && right > left && bottom > top) { "Mask is outside image bounds" }
        canvas.drawRect(left, top, right, bottom, paint)
      }
      FileOutputStream(outputPath).use { stream ->
        if (!output.compress(Bitmap.CompressFormat.PNG, 100, stream)) throw IllegalStateException("Masked image write failed")
      }
      source.recycle()
      output.recycle()
      outputPath
    }
  }
}
