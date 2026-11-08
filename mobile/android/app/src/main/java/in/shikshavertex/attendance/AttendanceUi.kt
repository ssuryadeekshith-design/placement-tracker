package `in`.shikshavertex.attendance

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.res.ResourcesCompat

enum class Tone { NEUTRAL, SUCCESS, WARNING, DANGER }

/** Shared native design tokens. Views remain regular accessible Android controls. */
class AttendanceUi(private val context: Context) {
    companion object {
        val INK = Color.rgb(15, 23, 42)
        val MUTED = Color.rgb(71, 85, 105)
        val BLUE = Color.rgb(37, 99, 235)
        val INDIGO = Color.rgb(30, 27, 75)
        val GREEN = Color.rgb(4, 120, 87)
        val AMBER = Color.rgb(146, 64, 14)
        val RED = Color.rgb(185, 28, 28)
        val CANVAS = Color.rgb(248, 250, 252)
        val BORDER = Color.rgb(226, 232, 240)
        private var font: Typeface? = null
    }
    fun dp(value: Int) = (value * context.resources.displayMetrics.density).toInt()
    private fun face(weight: Int): Typeface {
        if (font == null) font = runCatching { ResourcesCompat.getFont(context, R.font.inter) }.getOrNull() ?: Typeface.SANS_SERIF
        return Typeface.create(font, weight, false)
    }
    fun text(text: String, size: Float = 14f, color: Int = INK, bold: Boolean = false) = TextView(context).apply {
        this.text = text; textSize = size; setTextColor(color); typeface = face(if (bold) 650 else 400)
        setLineSpacing(dp(3).toFloat(), 1f); fontFeatureSettings = "tnum"
    }
    fun column() = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
    fun row() = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = android.view.Gravity.CENTER_VERTICAL }
    fun canvas() = column().apply {
        setBackgroundColor(CANVAS)
        setPadding(dp(20), dp(20), dp(20), dp(16))
        layoutParams = ViewGroup.LayoutParams(-1, -1)
    }
    fun rounded(color: Int = Color.WHITE, border: Int = BORDER, radius: Int = 12) = GradientDrawable().apply {
        setColor(color); cornerRadius = dp(radius).toFloat(); setStroke(dp(1).coerceAtLeast(1), border)
    }
    fun card(parent: LinearLayout): LinearLayout = column().apply {
        background = rounded(); elevation = dp(1).toFloat(); setPadding(dp(18), dp(18), dp(18), dp(18))
        parent.addView(this, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(14) })
    }
    private fun colors(tone: Tone): Pair<Int, Int> = when (tone) {
        Tone.SUCCESS -> Color.rgb(236, 253, 245) to GREEN
        Tone.WARNING -> Color.rgb(255, 251, 235) to AMBER
        Tone.DANGER -> Color.rgb(254, 242, 242) to RED
        Tone.NEUTRAL -> Color.rgb(239, 246, 255) to Color.rgb(30, 64, 175)
    }
    fun chip(parent: LinearLayout, text: String, tone: Tone = Tone.NEUTRAL): TextView {
        val (bg, fg) = colors(tone)
        return text(text, 11f, fg, true).apply {
            background = rounded(bg, bg, 8); setPadding(dp(9), dp(5), dp(9), dp(5))
            parent.addView(this, LinearLayout.LayoutParams(-2, -2).apply { rightMargin = dp(6); bottomMargin = dp(6) })
        }
    }
    fun button(parent: LinearLayout, label: String, primary: Boolean = false, action: () -> Unit): Button = Button(context).apply {
        text = label; textSize = 14f; typeface = face(650); isAllCaps = false; minHeight = dp(52)
        setPadding(dp(16), dp(12), dp(16), dp(12))
        val states = arrayOf(intArrayOf(-android.R.attr.state_enabled), intArrayOf())
        setTextColor(ColorStateList(states, intArrayOf(MUTED, if (primary) Color.WHITE else BLUE)))
        val surface = rounded().apply {
            setColor(ColorStateList(states, intArrayOf(if (primary) Color.rgb(219, 234, 254) else CANVAS, if (primary) BLUE else Color.WHITE)))
            setStroke(dp(1).coerceAtLeast(1), ColorStateList(states, intArrayOf(BORDER, if (primary) BLUE else BORDER)))
        }
        background = RippleDrawable(ColorStateList.valueOf(Color.rgb(191, 219, 254)), surface, null)
        setOnClickListener { action() }
        parent.addView(this, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })
    }
    fun field(parent: LinearLayout, label: String, value: String = ""): EditText {
        parent.addView(text(label, 12f, MUTED, true), LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(7); topMargin = dp(10) })
        return EditText(context).apply {
            setText(value); hint = label; contentDescription = label; textSize = 14f; typeface = face(400)
            setTextColor(INK); setHintTextColor(MUTED); isSingleLine = true; minHeight = dp(52)
            setPadding(dp(13), dp(12), dp(13), dp(12)); background = rounded(CANVAS)
            parent.addView(this, LinearLayout.LayoutParams(-1, -2))
        }
    }
    fun section(parent: LinearLayout, title: String, description: String = "") {
        parent.addView(text(title, 18f, INDIGO, true))
        if (description.isNotBlank()) parent.addView(text(description, 12f, MUTED), LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6) })
    }
    fun space(parent: LinearLayout, height: Int = 12) { parent.addView(android.view.View(context), LinearLayout.LayoutParams(1, dp(height))) }
    fun banner(parent: LinearLayout, title: String, body: String, tone: Tone) {
        val (bg, fg) = colors(tone)
        val panel = card(parent); panel.background = rounded(bg, bg); panel.elevation = 0f
        panel.addView(text(title, 13f, fg, true)); space(panel, 6); panel.addView(text(body, 12f, fg))
    }
}
