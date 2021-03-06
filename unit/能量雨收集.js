importClass(java.util.concurrent.LinkedBlockingQueue)
importClass(java.util.concurrent.ThreadPoolExecutor)
importClass(java.util.concurrent.TimeUnit)
importClass(java.util.concurrent.CountDownLatch)
importClass(java.util.concurrent.ThreadFactory)
importClass(java.util.concurrent.Executors)
importClass(com.stardust.autojs.core.graphics.ScriptCanvas)

let currentEngine = engines.myEngine()
let runningEngines = engines.all()
let runningSize = runningEngines.length
let currentSource = currentEngine.getSource() + ''
if (runningSize > 1) {
  runningEngines.forEach(engine => {
    let compareEngine = engine
    let compareSource = compareEngine.getSource() + ''
    if (currentEngine.id !== compareEngine.id && compareSource === currentSource) {
      // 强制关闭同名的脚本
      compareEngine.forceStop()
    }
  })
}
let { config } = require('../config.js')(runtime, this)
let sRequire = require('../lib/SingletonRequirer.js')(runtime, this)
let automator = sRequire('Automator')
let { debugInfo, warnInfo, errorInfo, infoLog, logInfo, debugForDev } = sRequire('LogUtils')
let commonFunction = sRequire('CommonFunction')
let widgetUtils = sRequire('WidgetUtils')
let resourceMonitor = require('../lib/ResourceMonitor.js')(runtime, this)
if (!commonFunction.requestScreenCaptureOrRestart(true)) {
  toastLog('获取截图权限失败，无法执行')
  exit()
}
let runningQueueDispatcher = sRequire('RunningQueueDispatcher')
commonFunction.autoSetUpBangOffset(true)
runningQueueDispatcher.addRunningTask()
let offset = config.bang_offset

let SCALE_RATE = config.scaleRate
let cvt = (v) => parseInt(v * SCALE_RATE)

let window = floaty.rawWindow(
  <canvas id="canvas" layout_weight="1" />
);

window.setSize(config.device_width, config.device_height)
window.setTouchable(false)

let threadPool = new ThreadPoolExecutor(4, 4, 60,
  TimeUnit.SECONDS, new LinkedBlockingQueue(16),
  new ThreadFactory({
    newThread: function (runnable) {
      let thread = Executors.defaultThreadFactory().newThread(runnable)
      thread.setName('energy-rain-' + thread.getName())
      return thread
    }
  })
)
let startTime = new Date().getTime()
// 两分钟后自动关闭
let targetEndTime = startTime + 120000
let passwindow = 0
let isTest = true
let isRunning = true
let isWaiting = true
let displayInfoZone = [config.device_width * 0.05, config.device_height * 0.7, config.device_width * 0.9, 150 * config.scaleRate]
let writeLock = threads.lock()
let clickComplete = writeLock.newCondition()
let ballsComplete = writeLock.newCondition()
let clickPoint = null


let recognize_region = null

let startTimestamp = new Date().getTime()
let noBallCount = 0
let passedTime = 0
let clickOffset = 0
threadPool.execute(function () {
  while (isRunning) {
    if (isWaiting) {
      sleep(100)
      continue
    }
    let start = new Date().getTime()
    debugInfo(['开始请求截图'])
    let screen = captureScreen()
    if (screen) {
      debugInfo(['请求截图成功：{}ms', new Date().getTime() - start])
      try {
        passedTime = (new Date().getTime() - startTimestamp) / 1000
        if (!isTest && config.rain_collect_debug_mode && passedTime >= 13) {
          automator.back()
          isTest = true
          changeButtonInfo()
        } else if (!isTest && passedTime > 20) {
          isTest = true
          changeButtonInfo()
        }
        if (recognize_region === null) {
          recognize_region = [0, screen.height * 0.1, screen.width, screen.height * 0.3]
        }
        let point = images.findColor(screen, '#CDFF00', { region: recognize_region, threshold: 1 })
        if (point) {
          noBallCount = 0
          writeLock.lock()
          try {
            clickPoint = point
            if (config.use_maintain_click_offset) {
              clickOffset = passedTime >= 9 ? config.maintain_click_offset_after || cvt(100) : config.maintain_click_offset_before || cvt(50)
            } else {
              clickOffset = passedTime >= 9 ? cvt(100) : cvt(50)
            }
            ballsComplete.signal()
            // 等待点击完毕
            clickComplete.await()
          } finally {
            writeLock.unlock()
          }
        } else {
          debugInfo(['no ball found cost: {}', new Date().getTime() - start])
          if (++noBallCount >= 3) {
            // 重新开始
            startTimestamp = new Date().getTime()
          }
        }
      } catch (e) {
        errorInfo('识别线程执行异常' + e)
        commonFunction.printExceptionStack(e)
      }
    } else {
      debugInfo(['请求截图失败：{}ms', new Date().getTime() - start])
    }
  }
})

// 点击线程
threadPool.execute(function () {
  while (isRunning) {
    writeLock.lock()
    while (clickPoint == null) {
      debugInfo(['图片未识别完成，等待'])
      ballsComplete.await()
    }
    try {
      debugInfo(['图片识别识别完成，得到球位置：{},{}', clickPoint.x, clickPoint.y])
      let start = new Date().getTime()
      if (isTest) {
        sleep(150)
      } else {
        automator.click(clickPoint.x, clickPoint.y + clickOffset)
      }
      debugInfo(['点击完毕 耗时：{}ms', new Date().getTime() - start])
      clickPoint = null
      clickComplete.signal()
    } catch (e) {
      errorInfo('点击线程执行异常：' + e)
      commonFunction.printExceptionStack(e)
    } finally {
      writeLock.unlock()
    }
  }
})

let clickButtonWindow = floaty.rawWindow(
  <vertical padding="8">
    <vertical>
      <button id="openRainPage" text="打开能量雨界面" />
    </vertical>
    <vertical>
      <button id="changeStatus" text="开始点击" />
    </vertical>
    <vertical>
      <button id="delayClose" text="续命" />
    </vertical>
    <vertical>
      <button id="closeBtn" text="关闭" />
    </vertical>
  </vertical>
);

clickButtonWindow.openRainPage.click(function () {
  threadPool.execute(function () {
    openRainPage()
  })
})

clickButtonWindow.changeStatus.click(function () {
  isTest = !isTest
  changeButtonInfo()
})

clickButtonWindow.closeBtn.click(function () {
  exitAndClean()
})

clickButtonWindow.delayClose.click(function () {
  targetEndTime = new Date().getTime() + 120000
})

ui.run(function () {
  clickButtonWindow.changeStatus.setBackgroundColor(colors.parseColor('#9ed900'))
  clickButtonWindow.setPosition(cvt(100), config.device_height * 0.7)
})

window.canvas.on("draw", function (canvas) {
  if (!isRunning) {
    return
  }
  try {
    // 清空内容
    canvas.drawColor(0xFFFFFF, android.graphics.PorterDuff.Mode.CLEAR)
    let Typeface = android.graphics.Typeface
    let paint = new Paint()
    paint.setStrokeWidth(1)
    paint.setTypeface(Typeface.DEFAULT_BOLD)
    paint.setTextAlign(Paint.Align.LEFT)
    paint.setAntiAlias(true)
    paint.setStrokeJoin(Paint.Join.ROUND)
    paint.setDither(true)

    recognize_region != null && drawRectAndText('识别区域', recognize_region, '#888888', canvas, paint)

    // 倒计时
    paint.setTextSize(30)
    let countdown = (targetEndTime - new Date().getTime()) / 1000
    drawText('请进入能量雨界面并手动开始，音量上键可关闭', { x: displayInfoZone[0], y: displayInfoZone[1] - 200 }, canvas, paint)
    drawText('将在' + countdown.toFixed(0) + 's后自动关闭', { x: displayInfoZone[0], y: displayInfoZone[1] - 150 }, canvas, paint)
    drawText('音量下键进入' + (isTest ? '点击模式' : '识别模式') + ' 点击偏移量：' + clickOffset, { x: displayInfoZone[0], y: displayInfoZone[1] - 100 }, canvas, paint, '#ff0000')
    drawText('如果漏收严重，请清理手机后台避免卡顿', { x: displayInfoZone[0], y: displayInfoZone[1] - 50 }, canvas, paint, '#00ff00')
    if (config.rain_collect_debug_mode) {
      drawText(passedTime + ' config:' + config.use_maintain_click_offset + ' ' + config.maintain_click_offset_after + ',' + config.maintain_click_offset_before, { x: displayInfoZone[0], y: displayInfoZone[1] }, canvas, paint, '#00ff00')
    }
    passwindow = new Date().getTime() - startTime

    if (isTest) {
      let displayBallPoint = clickPoint
      if (displayBallPoint) {
        let radius = cvt(60)
        drawRectAndText('能量球', [displayBallPoint.x - radius, displayBallPoint.y - radius, radius * 2, radius * 2], '#00ff00', canvas, paint)
      }
    }
    if (passwindow > 1000) {
      startTime = new Date().getTime()
      console.verbose('关闭倒计时：' + countdown.toFixed(2))
    }
  } catch (e) {
    commonFunction.printExceptionStack(e)
    exitAndClean()
  }
})

let lastChangedTime = new Date().getTime()
threads.start(function () {
  toastLog('按音量上键关闭，音量下切换模式')
  events.observeKey()
  events.on("key_down", function (keyCode, event) {
    if (keyCode === 24) {
      exitAndClean()
    } else if (keyCode === 25) {
      // 设置最低间隔200毫秒，避免修改太快
      if (new Date().getTime() - lastChangedTime > 200) {
        lastChangedTime = new Date().getTime()
        isTest = !isTest
        changeButtonInfo()
      }
    }
  })
})

setInterval(function () { 
  if (targetEndTime < new Date().getTime()) {
    exitAndClean() 
  }
}, 1000)

function exitAndClean () {
  if (!isRunning) {
    return
  }
  isRunning = false
  if (window !== null) {
    window.canvas.removeAllListeners()
    toastLog('close in 1 seconds')
    setTimeout(function () {
      window.close()
      exit()
    }, 1000)
  } else {
    exit()
  }
}

commonFunction.registerOnEngineRemoved(function () {
  runningQueueDispatcher.removeRunningTask()
  isRunning = false
  threadPool.shutdown()
  debugInfo(['等待线程池关闭:{}', threadPool.awaitTermination(5, TimeUnit.SECONDS)])
})

// ---------------------

function changeButtonInfo () {
  isWaiting = false
  clickButtonWindow.changeStatus.setText(isTest ? '开始点击' : '停止点击')
  clickButtonWindow.changeStatus.setBackgroundColor(isTest ? colors.parseColor('#9ed900') : colors.parseColor('#f36838'))
}

function convertArrayToRect (a) {
  // origin array left top width height
  // left top right bottom
  return new android.graphics.Rect(a[0], a[1] + offset, (a[0] + a[2]), (a[1] + offset + a[3]))
}

function drawRectAndText (desc, position, colorStr, canvas, paint) {
  let color = colors.parseColor(colorStr)

  paint.setStrokeWidth(1)
  paint.setStyle(Paint.Style.STROKE)
  // 反色
  paint.setARGB(255, 255 - (color >> 16 & 0xff), 255 - (color >> 8 & 0xff), 255 - (color & 0xff))
  canvas.drawRect(convertArrayToRect(position), paint)
  paint.setARGB(255, color >> 16 & 0xff, color >> 8 & 0xff, color & 0xff)
  paint.setStrokeWidth(1)
  paint.setTextSize(20)
  paint.setStyle(Paint.Style.FILL)
  canvas.drawText(desc, position[0], position[1] + offset, paint)
  paint.setTextSize(10)
  paint.setStrokeWidth(1)
  paint.setARGB(255, 0, 0, 0)
}

function drawText (text, position, canvas, paint, colorStr) {
  colorStr = colorStr || '#0000ff'
  let color = colors.parseColor(colorStr)
  paint.setARGB(255, color >> 16 & 0xff, color >> 8 & 0xff, color & 0xff)
  paint.setStrokeWidth(1)
  paint.setStyle(Paint.Style.FILL)
  canvas.drawText(text, position.x, position.y + offset, paint)
}
let starting = false
function openRainPage () {
  if (starting) {
    return
  }
  ui.run(function () {
    clickButtonWindow.openRainPage.setText('正在打开能量雨界面')
  })
  starting = true
  app.startActivity({
    action: 'VIEW',
    data: 'alipays://platformapi/startapp?appId=20000067&url=' + encodeURIComponent('https://68687791.h5app.alipay.com/www/index.html'),
    packageName: config.package_name
  })
  let confirm = widgetUtils.widgetGetOne(/^打开$/, 3000)
  if (confirm) {
    automator.clickCenter(confirm)
  }
  ui.run(function () {
    clickButtonWindow.openRainPage.setText('打开能量雨界面')
  })
  starting = false
}