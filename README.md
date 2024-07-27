# 汉化
这是[shell-bot](https://github.com/botgram/shell-bot)项目的一个中文的分支。
如果有任何非本土化相关的问题请去上游反馈、讨论。
# shell-bot

这是一个完全功能的 shellrunner [Telegram 机器人][]. 你告诉它一个命令，它会执行它并发送实时的输出。你可以通过回复输出消息来发送shell输入。

这是一个相当复杂的示例，因为命令行中会解释转义序列，并且**如果它们的行被改变，它将更新消息**。这意味着诸如 wget 等交互式程序工作时，你应该会看到状态更新。

该机器人还允许上传或下载文件，并且还提供了一个简单的文本编辑器以方便使用。

这里有一个示例，展示了机器人运行 `git` 来克隆一个存储库：

![基本任务](http://i.imgur.com/Xxtoe4G.png)

这里有一个示例，展示了机器人运行 alsamixer：

![带有键盘的Alsamixer](http://i.imgur.com/j8aXFLd.png)

这个机器人展示了 [Botgram][] API 的一个重要部分。

**注意：** 由于高度的集成，目前*不*支持在 Windows 上运行该机器人。

## 安装

首先安装 [node-pty 依赖](https://github.com/Microsoft/node-pty#dependencies)。例如，如果你使用的是 Ubuntu/Debian：

~~~
sudo apt install -y make python build-essential
~~~

如果你使用的是 fedora：
```
sudo dnf install -y python
sudo dnf group install -y "C Development Tools and Libraries" 
```
Arch用户：
```
sudo pacman -S base-devel  npm python
```
在使用之前，你应该已经为你的机器人获取了一个授权令牌，并知道你个人账号的数字ID。如果你不知道这意味着什么，可以查看[博文](https://tsaitang.com/xcC1onW1MSVD)了解更多。

~~~
git clone https://github.com/botgram/shell-bot.git && cd shell-bot
npm install
~~~
如果失败了，可以尝试清理缓存并更新
```
npm cache clean --force
npm update
```

启动机器人：

~~~
node server
~~~

第一次运行时，它会询问你一些问题，并自动创建配置文件：`config.json`。你也可以手动编写它，请参阅 `config.example.json`。

当启动时，它将在运行时打印 `就绪了！` 消息。为了方便起见，你可能想要与 BotFather 对话，并将命令列表设置为 `commands.txt` 的内容。

## 授权

首次启动时，机器人只会接受来自你的用户的消息。这是出于安全原因：你不希望任意人发出命令给你的计算机！

如果你想允许另一个用户使用该机器人，可以使用 `/token` 命令，并给该用户生成的链接。如果你想在一个群组中使用这个机器人，`/token` 将给你一个消息，让你转发到群组中。

## 代理服务器

shell-bot 遵循 `https_proxy` 或 `all_proxy` 环境变量来使用代理，并支持 HTTP/HTTPS/SOCKS4/SOCKS4A/SOCKS5 代理。示例：

~~~ bash
export https_proxy="http://168.63.76.32:3128"
node server

export https_proxy="socks://127.0.0.1:9050"
node server
~~~

**警告：** 对于 SOCKS 代理，你需要使用 IP 地址（而不是 DNS 主机名）。
------

[TelegramBot](https://core.telegram.org/bots)


[Botgram](https://botgram.js.org)


[博文](https://tsaitang.com/xcC1onW1MSVD)