import fs from 'node:fs';
import {safe,sha} from './raw-quality.mjs';
// Runs pin their route at creation; historical runs keep the previous route.
export function reviewerRoute(runOrState) {
  const state = runOrState.execution_control ?? runOrState;
  const version = state.reviewer_route_version ?? 1;
  if (![1, 2, 3].includes(version)) throw Error('Unsupported reviewer route version');
  if (version === 3) {
    const parent = state.parent_reviewer;
    if (!parent?.agent_id || !parent.model || !parent.reasoning_effort) throw Error('Bind the actual parent reviewer before semantic work');
    return {model: parent.model, reasoning_effort: parent.reasoning_effort};
  }
  return version === 2
    ? {model: 'gpt-5.6-sol', reasoning_effort: 'medium'}
    : {model: 'gpt-5.6-terra', reasoning_effort: 'high'};
}

export const parentReview = run => (run.execution_control ?? run).reviewer_route_version === 3;
export function reviewSession(run, agent) {
  const state = run.execution_control ?? run;
  return parentReview(run) && state.parent_reviewer?.agent_id === agent
    ? state.parent_reviewer : state.agent_sessions?.find(x => x.agent_id === agent);
}
export function assertReviewOwnership(run, agent, paths) {
  const state = run.execution_control ?? run, session = reviewSession(run, agent);
  if (!session || !['core_reviewer','raw_reviewer'].includes(session.role) || !matchesReviewerRoute(run, session)) throw Error('Registered reviewer matching the pinned route required');
  if (parentReview(run)) {
    if (session !== state.parent_reviewer) throw Error('This run uses the parent reviewer');
    for (const p of paths) {
      const author = state.artifact_authors?.[p];
      if (!author || author.agent_id === agent || !state.agent_sessions.some(x => x.agent_id === author.agent_id && ['raw_writer','wiki_writer','content_writer'].includes(x.role))) throw Error('Missing separate content author: ' + p);
    }
  } else if (agent === run.producer_context_id || state.agent_sessions.some(x => x.agent_id === agent && x.role === 'content_writer')) throw Error('Writer/producer cannot independently review');
  return session;
}
export function rawProducer(run, raw) {
  if (!parentReview(run)) return run.producer_context_id;
  const author = run.execution_control.artifact_authors?.[raw];
  if (!author?.agent_id) throw Error('Raw needs an assigned content author: ' + raw);
  assertReviewOwnership(run, run.execution_control.parent_reviewer?.agent_id, [raw]);
  return author.agent_id;
}
export function assertDelivered(root, run, paths) {
  if(!parentReview(run))return;
  const state=run.execution_control;
  for(const p of paths){
    const author=state.artifact_authors?.[p];
    const delivery=state.deliveries?.find(x=>x.dispatch_id===author?.dispatch_id&&x.agent_id===author?.agent_id);
    const output=delivery?.outputs.find(x=>x.path===p);
    if(!output||output.sha256!==sha(fs.readFileSync(safe(root,p))))throw Error('Current output not delivered for review: '+p);
  }
}
export function matchesReviewerRoute(runOrState, session) {
  const expected = reviewerRoute(runOrState);
  return !!session && session.model === expected.model && session.reasoning_effort === expected.reasoning_effort;
}
