import DefaultTheme from 'vitepress/theme';
import ProviderGrid from './components/ProviderGrid.vue';
import AgentGrid from './components/AgentGrid.vue';
import FlowDiagram from './components/FlowDiagram.vue';
import './custom.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('ProviderGrid', ProviderGrid);
    app.component('AgentGrid', AgentGrid);
    app.component('FlowDiagram', FlowDiagram);
  },
};
