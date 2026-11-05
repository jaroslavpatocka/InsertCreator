@echo off
setlocal
cd /d "%~dp0"
if not defined JAVA_HOME set "JAVA_HOME=%ProgramFiles%\Android\Android Studio\jbr"
if not defined ANDROID_HOME set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
if not exist "%JAVA_HOME%\bin\java.exe" (
  echo Set JAVA_HOME to a JDK supported by Gradle 9.3.1.
  exit /b 1
)
if not exist "%ANDROID_HOME%\platforms\android-37.0\android.jar" (
  echo Install Android SDK platform 37.0 and Build Tools 36.0.0.
  exit /b 1
)
if not exist ".local" mkdir ".local"
if not exist ".local\debug.keystore" (
  "%JAVA_HOME%\bin\keytool.exe" -genkeypair -keystore ".local\debug.keystore" -storepass android -keypass android -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US"
  if errorlevel 1 exit /b 1
)
call gradlew.bat --no-daemon --max-workers=2 --console=plain assembleDebug bundleRelease lintDebug validateReleaseBundle
exit /b %ERRORLEVEL%
