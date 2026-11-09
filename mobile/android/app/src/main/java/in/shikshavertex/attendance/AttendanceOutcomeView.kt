package `in`.shikshavertex.attendance

import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.*
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.animation.OvershootInterpolator

enum class AttendanceOutcome { VERIFYING, SUCCESS, REJECTED }

/** Native vector drawing: no image downloads, no fabricated progress or receipts. */
class AttendanceOutcomeView(context: Context) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val running = mutableListOf<android.animation.Animator>()
    private var outcome = AttendanceOutcome.VERIFYING
    private var reveal = 1f
    private var ripple = 0f
    private var haptic: Runnable? = null
    private val checkPath = Path()
    private val checkSegment = Path()
    private val checkMeasure = PathMeasure()
    private var sphereShaders: Array<Shader>? = null
    init { importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO }

    fun show(value: AttendanceOutcome, animate: Boolean) {
        stop(); outcome = value; reveal = 1f; ripple = 0f
        scaleX = 1f; scaleY = 1f; translationX = 0f
        if (animate && ValueAnimator.areAnimatorsEnabled() && isAttachedToWindow && isShown && windowVisibility == VISIBLE) {
            when (value) {
                AttendanceOutcome.VERIFYING -> tween(1200, repeat = true) { ripple = it; invalidate() }
                AttendanceOutcome.SUCCESS -> {
                    scaleX = .25f; scaleY = .25f; reveal = 0f
                    ObjectAnimator.ofFloat(this, SCALE_X, .25f, 1f).apply { duration = 500; interpolator = OvershootInterpolator(1.5f); running.add(this); start() }
                    ObjectAnimator.ofFloat(this, SCALE_Y, .25f, 1f).apply { duration = 500; interpolator = OvershootInterpolator(1.5f); running.add(this); start() }
                    tween(900) { ripple = it; invalidate() }
                    tween(320, delay = 500) { reveal = it; invalidate() }
                    performHapticFeedback(if (android.os.Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY)
                }
                AttendanceOutcome.REJECTED -> {
                    ObjectAnimator.ofFloat(this, TRANSLATION_X, 0f, -dp(7), dp(7), -dp(5), dp(5), 0f).apply { duration = 400; running.add(this); start() }
                    performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                    haptic = Runnable { if (isAttachedToWindow && isShown && windowVisibility == VISIBLE) performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY) }
                    postDelayed(haptic!!, 100)
                }
            }
        }
        invalidate()
    }
    private fun dp(value: Int) = value * resources.displayMetrics.density
    private fun tween(durationMs: Long, delay: Long = 0, repeat: Boolean = false, update: (Float) -> Unit) {
        ValueAnimator.ofFloat(0f, 1f).apply {
            duration = durationMs; startDelay = delay
            if (repeat) repeatCount = ValueAnimator.INFINITE
            addUpdateListener { update(it.animatedValue as Float) }; running.add(this); start()
        }
    }
    fun pauseMotion() { stop(); reveal=1f; scaleX=1f; scaleY=1f; translationX=0f; invalidate() }
    override fun onSizeChanged(w: Int,h: Int,oldw: Int,oldh: Int) {
        super.onSizeChanged(w,h,oldw,oldh)
        val cx=w/2f; val cy=h/2f; val r=minOf(w,h)*.29f
        if(r<=0) return
        sphereShaders=arrayOf(
            RadialGradient(cx-r*.3f,cy-r*.45f,r*1.7f,intArrayOf(AttendanceUi.BLUE,AttendanceUi.BLUE),null,Shader.TileMode.CLAMP),
            RadialGradient(cx-r*.3f,cy-r*.45f,r*1.7f,intArrayOf(Color.rgb(52,211,153),Color.rgb(16,185,129),Color.rgb(5,150,105)),null,Shader.TileMode.CLAMP),
            RadialGradient(cx-r*.3f,cy-r*.45f,r*1.7f,intArrayOf(Color.rgb(239,68,68),Color.rgb(239,68,68)),null,Shader.TileMode.CLAMP))
        checkPath.reset(); checkPath.moveTo(cx-r*.44f,cy); checkPath.lineTo(cx-r*.12f,cy+r*.32f); checkPath.lineTo(cx+r*.48f,cy-r*.32f)
        checkMeasure.setPath(checkPath,false)
    }
    private fun stop() { running.forEach { it.cancel() }; running.clear(); haptic?.let(::removeCallbacks); haptic = null }
    override fun onDetachedFromWindow() { stop(); super.onDetachedFromWindow() }
    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(visibility)
        if (visibility != VISIBLE) { stop(); reveal = 1f; scaleX = 1f; scaleY = 1f; translationX = 0f }
        else if (isAttachedToWindow && isShown && outcome == AttendanceOutcome.VERIFYING) show(outcome, true)
    }
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val cx = width / 2f; val cy = height / 2f; val radius = minOf(width, height) * .29f
        val color = when (outcome) { AttendanceOutcome.SUCCESS -> Color.rgb(16,185,129); AttendanceOutcome.REJECTED -> Color.rgb(239,68,68); else -> AttendanceUi.BLUE }
        paint.shader = null; paint.style = Paint.Style.STROKE; paint.strokeWidth = dp(2)
        paint.color = color; paint.alpha = ((1-ripple)*75).toInt()
        if (outcome != AttendanceOutcome.REJECTED) canvas.drawCircle(cx,cy,radius*(1.1f+ripple*.55f),paint)
        paint.alpha = 255; paint.style = Paint.Style.FILL
        paint.shader = sphereShaders?.get(outcome.ordinal)
        canvas.drawCircle(cx,cy,radius,paint); paint.shader = null
        paint.color = Color.WHITE; paint.style = Paint.Style.STROKE; paint.strokeWidth = dp(4); paint.strokeCap = Paint.Cap.ROUND; paint.strokeJoin = Paint.Join.ROUND
        when (outcome) {
            AttendanceOutcome.SUCCESS -> {
                checkSegment.reset(); checkMeasure.getSegment(0f,checkMeasure.length*reveal,checkSegment,true); canvas.drawPath(checkSegment,paint)
            }
            AttendanceOutcome.REJECTED -> {
                canvas.drawLine(cx-radius*.3f,cy-radius*.3f,cx+radius*.3f,cy+radius*.3f,paint)
                canvas.drawLine(cx+radius*.3f,cy-radius*.3f,cx-radius*.3f,cy+radius*.3f,paint)
            }
            AttendanceOutcome.VERIFYING -> {
                canvas.drawCircle(cx,cy,radius*.45f,paint)
                val angle = ripple*2*Math.PI; canvas.drawLine(cx,cy,cx+(kotlin.math.cos(angle)*radius*.45).toFloat(),cy+(kotlin.math.sin(angle)*radius*.45).toFloat(),paint)
            }
        }
    }
}
