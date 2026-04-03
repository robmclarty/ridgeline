---
event: PreToolUse
tool: Bash
---
Block any bash command that makes outbound network requests.

Deny commands containing: curl, wget, nc, ncat, netcat, ssh, scp, sftp,
rsync (with remote paths), python -m http.server, node -e with http/https
modules, telnet, ftp.

Allow these exceptions:
- npm install, npm ci, npm update
- npx (any arguments)
- pip install, pip3 install
- cargo build, cargo install
- gem install, bundle install
- go get, go install, go mod download
- git fetch, git pull, git clone, git push
- brew install

If the command is blocked, return "block" with a message explaining that
network access is restricted. Suggest using an allowed package manager
command instead.
