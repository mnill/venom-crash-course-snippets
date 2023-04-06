This is sample how to deploy your own production ready tip3 token via locklift and use them in real application. 

Prerequisites:

[Nodejs 16 +](https://nodejs.org/en/)  
[Docker](https://www.docker.com)  
[Everdev](https://github.com/tonlabs/everdev)

```
// Launce local blockchain node
everdev se start 
// Install dependecies
npm i
// Run the test on local network
npx locklift test -n local

// Or you can configure your own giver/keys in locklift.config.json
// And deploy token in any of networks
```