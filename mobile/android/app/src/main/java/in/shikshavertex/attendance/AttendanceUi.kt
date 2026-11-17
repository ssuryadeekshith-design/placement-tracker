package `in`.shikshavertex.attendance

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.graphics.drawable.StateListDrawable
import android.view.View
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.ImageView
import androidx.core.content.res.ResourcesCompat

enum class Tone { NEUTRAL, SUCCESS, WARNING, DANGER }

/** Shared native design tokens. Views remain regular accessible Android controls. */
class AttendanceUi(private val context: Context) {
    companion object {
        val INK = Color.rgb(24, 35, 57)
        val MUTED = Color.rgb(82, 97, 122)
        val BLUE = Color.rgb(45, 85, 223)
        val INDIGO = Color.rgb(36, 34, 85)
        val GREEN = Color.rgb(4, 120, 87)
        val AMBER = Color.rgb(146, 64, 14)
        val RED = Color.rgb(185, 28, 28)
        val CANVAS = Color.rgb(244, 246, 251)
        val BORDER = Color.rgb(223, 229, 239)
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
        setPadding(dp(18), dp(20), dp(18), dp(18))
        layoutParams = ViewGroup.LayoutParams(-1, -1)
    }
    fun rounded(color: Int = Color.WHITE, border: Int = BORDER, radius: Int = 12) = GradientDrawable().apply {
        setColor(color); cornerRadius = dp(radius).toFloat(); setStroke(dp(1).coerceAtLeast(1), border)
    }
    fun card(parent: LinearLayout): LinearLayout = column().apply {
        background = rounded(radius = 20); elevation = dp(1).toFloat(); setPadding(dp(20), dp(20), dp(20), dp(20))
        parent.addView(this, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(16) })
    }
    private fun colors(tone: Tone): Pair<Int, Int> = when (tone) {
        Tone.SUCCESS -> Color.rgb(236, 253, 245) to GREEN
        Tone.WARNING -> Color.rgb(255, 251, 235) to AMBER
        Tone.DANGER -> Color.rgb(254, 242, 242) to RED
        Tone.NEUTRAL -> Color.rgb(239, 246, 255) to Color.rgb(30, 64, 175)
    }
    fun chip(parent: LinearLayout, text: String, tone: Tone = Tone.NEUTRAL): TextView {
        val (bg, fg) = colors(tone)
        return text(text, 12f, fg, true).apply {
            background = rounded(bg, bg, 10); setPadding(dp(10), dp(6), dp(10), dp(6))
            parent.addView(this, LinearLayout.LayoutParams(-2, -2).apply { rightMargin = dp(6); bottomMargin = dp(6) })
        }
    }
    fun button(parent: LinearLayout, label: String, primary: Boolean = false, action: () -> Unit): Button = Button(context).apply {
        text = label; textSize = 14f; typeface = face(650); isAllCaps = false; minHeight = dp(52)
        setPadding(dp(16), dp(12), dp(16), dp(12))
        val states = arrayOf(intArrayOf(-android.R.attr.state_enabled), intArrayOf())
        setTextColor(ColorStateList(states, intArrayOf(MUTED, if (primary) Color.WHITE else BLUE)))
        val surface = rounded(radius = 13).apply {
            setColor(ColorStateList(states, intArrayOf(if (primary) Color.rgb(219, 234, 254) else CANVAS, if (primary) BLUE else Color.WHITE)))
            setStroke(dp(1).coerceAtLeast(1), ColorStateList(states, intArrayOf(BORDER, if (primary) BLUE else BORDER)))
        }
        val drawable = if (primary) StateListDrawable().apply {
            addState(intArrayOf(-android.R.attr.state_enabled), surface)
            addState(intArrayOf(), GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(BLUE, Color.rgb(64, 57, 178))).apply { cornerRadius = dp(13).toFloat() })
        } else surface
        background = RippleDrawable(ColorStateList.valueOf(Color.rgb(191, 219, 254)), drawable, null)
        stateListAnimator = null
        setOnClickListener { action() }
        parent.addView(this, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })
    }
    fun field(parent: LinearLayout, label: String, value: String = ""): EditText {
        parent.addView(text(label, 12f, MUTED, true), LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(7); topMargin = dp(10) })
        return EditText(context).apply {
            setText(value); hint = label; contentDescription = label; textSize = 14f; typeface = face(400)
            setTextColor(INK); setHintTextColor(MUTED); isSingleLine = true; minHeight = dp(52)
            setPadding(dp(14), dp(13), dp(14), dp(13))
            background = StateListDrawable().apply {
                addState(intArrayOf(android.R.attr.state_focused), rounded(Color.WHITE, BLUE, 12))
                addState(intArrayOf(), rounded(Color.rgb(251, 252, 255), BORDER, 12))
            }
            parent.addView(this, LinearLayout.LayoutParams(-1, -2))
        }
    }
    fun section(parent: LinearLayout, title: String, description: String = "") {
        parent.addView(text(title, 19f, INDIGO, true))
        if (description.isNotBlank()) parent.addView(text(description, 13f, MUTED), LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(7) })
    }
    fun brandHeader(subtitle: String = "Employee workspace"): LinearLayout = row().apply {
        setPadding(dp(16), dp(18), dp(16), dp(18))
        background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(INDIGO, Color.rgb(29, 43, 77))).apply { cornerRadius = dp(20).toFloat() }
        addView(ImageView(context).apply {
            setImageResource(R.drawable.shikshavertex_launcher)
            scaleType = ImageView.ScaleType.FIT_CENTER
            background = rounded(Color.WHITE, Color.WHITE, 13); clipToOutline = true
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }, LinearLayout.LayoutParams(dp(52), dp(52)).apply { marginEnd = dp(13) })
        addView(column().apply {
            addView(text("SHIKSHAVERTEX", 12f, Color.WHITE, true).apply { letterSpacing = .1f })
            addView(text(subtitle, 12f, Color.rgb(213, 223, 249)))
        }, LinearLayout.LayoutParams(0, -2, 1f))
    }
    fun disclosure(parent: LinearLayout, title: String, explanation: String) {
        val details = text(explanation, 12f, MUTED).apply { visibility = View.GONE }
        lateinit var toggle: Button
        toggle = button(parent, title) {
            val expanded = details.visibility != View.VISIBLE
            details.visibility = if (expanded) View.VISIBLE else View.GONE
            toggle.text = if (expanded) "Hide details" else title
            toggle.contentDescription = "$title, ${if (expanded) "expanded" else "collapsed"}"
        }.apply {
            minHeight = dp(48); textSize = 12f; gravity = Gravity.START or Gravity.CENTER_VERTICAL
            background = RippleDrawable(ColorStateList.valueOf(Color.rgb(219, 228, 255)), rounded(Color.rgb(247, 249, 255), Color.rgb(232, 237, 248), 11), null)
            contentDescription = "$title, collapsed"
        }
        parent.addView(details, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(10) })
    }
    fun space(parent: LinearLayout, height: Int = 12) { parent.addView(android.view.View(context), LinearLayout.LayoutParams(1, dp(height))) }
    fun banner(parent: LinearLayout, title: String, body: String, tone: Tone) {
        val (bg, fg) = colors(tone)
        val panel = card(parent); panel.background = rounded(bg, bg); panel.elevation = 0f
        panel.addView(text(title, 13f, fg, true)); space(panel, 6); panel.addView(text(body, 12f, fg))
    }
}
